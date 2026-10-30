// Shared helpers for the student-area admin scripts.
// Credentials come from the usual AWS chain (AWS_PROFILE, ~/.aws/credentials, ...).
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUserGlobalSignOutCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { BatchWriteItemCommand, DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

export const REGION = process.env.AWS_REGION || 'eu-central-1';
export const DEFAULT_STACK = process.env.STUDENTS_STACK || 'laguitarrita-students';

export const cognito = new CognitoIdentityProviderClient({ region: REGION });
export const s3 = new S3Client({ region: REGION });
export const dynamo = new DynamoDBClient({ region: REGION });

const outputsCache = new Map();

/** Reads UserPoolId, UserPoolClientId, BucketName, NotesTableName and ApiUrl from the stack outputs. */
export async function stackOutputs(stackName = DEFAULT_STACK) {
  if (!outputsCache.has(stackName)) {
    const cfn = new CloudFormationClient({ region: REGION });
    const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
    const outputs = Object.fromEntries((Stacks[0].Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
    outputsCache.set(stackName, outputs);
  }
  return outputsCache.get(stackName);
}

// Pseudonyms only: no e-mail addresses or real names are stored anywhere.
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;

/** Lower-cases the username and checks it is simple: letters, digits, '.', '-', '_' (3-32). */
export function normalizeUsername(username) {
  const value = String(username ?? '').trim().toLowerCase();
  if (!USERNAME_PATTERN.test(value)) {
    throw new Error('The username must be 3-32 characters: letters, digits, ".", "-" or "_".');
  }
  return value;
}

export function assertPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('The password must be at least 8 characters long.');
  }
}

export const videosPrefix = (sub) => `students/${sub}/videos/`;

export async function createStudent({ stack, username, password }) {
  const { UserPoolId } = await stackOutputs(stack);
  username = normalizeUsername(username);
  assertPassword(password);
  const { User } = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId,
      Username: username,
      MessageAction: 'SUPPRESS', // never send any Cognito message
    }),
  );
  await setPermanentPassword({ stack, username, password, signOut: false });
  return User.Attributes.find((a) => a.Name === 'sub').Value;
}

export async function setPermanentPassword({ stack, username, password, signOut = true }) {
  const { UserPoolId } = await stackOutputs(stack);
  assertPassword(password);
  const Username = normalizeUsername(username);
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId, Username, Password: password, Permanent: true }));
  // Invalidate refresh tokens issued with the old password.
  if (signOut) await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId, Username }));
}

export async function getStudent({ stack, username }) {
  const { UserPoolId } = await stackOutputs(stack);
  const user = await cognito.send(new AdminGetUserCommand({ UserPoolId, Username: normalizeUsername(username) }));
  const sub = user.UserAttributes.find((a) => a.Name === 'sub')?.Value;
  return { sub, username: user.Username, status: user.UserStatus };
}

export async function listStudents({ stack }) {
  const { UserPoolId } = await stackOutputs(stack);
  const users = [];
  let PaginationToken;
  do {
    const page = await cognito.send(new ListUsersCommand({ UserPoolId, PaginationToken }));
    users.push(...page.Users);
    PaginationToken = page.PaginationToken;
  } while (PaginationToken);
  return users.map((u) => {
    const sub = u.Attributes.find((a) => a.Name === 'sub')?.Value;
    return { sub, username: u.Username, created: u.UserCreateDate };
  });
}

export async function listVideoObjects({ stack, sub }) {
  const { BucketName } = await stackOutputs(stack);
  const objects = [];
  let ContinuationToken;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({ Bucket: BucketName, Prefix: `students/${sub}/`, ContinuationToken }),
    );
    objects.push(...(page.Contents ?? []));
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return objects;
}

/** Deletes all of a student's notes; returns how many there were. */
export async function deleteNotes({ stack, sub }) {
  const { NotesTableName } = await stackOutputs(stack);
  const keys = [];
  let ExclusiveStartKey;
  do {
    const page = await dynamo.send(
      new QueryCommand({
        TableName: NotesTableName,
        KeyConditionExpression: '#sub = :sub',
        ExpressionAttributeNames: { '#sub': 'sub', '#video': 'video' },
        ExpressionAttributeValues: { ':sub': { S: sub } },
        ProjectionExpression: '#sub, #video',
        ExclusiveStartKey,
      }),
    );
    keys.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  for (let i = 0; i < keys.length; i += 25) {
    let RequestItems = { [NotesTableName]: keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })) };
    while (RequestItems && Object.keys(RequestItems).length) {
      ({ UnprocessedItems: RequestItems } = await dynamo.send(new BatchWriteItemCommand({ RequestItems })));
    }
  }
  return keys.length;
}

export async function deleteStudent({ stack, username, deleteVideos = false }) {
  const { UserPoolId, BucketName } = await stackOutputs(stack);
  const { sub } = await getStudent({ stack, username });
  // The notes belong to the student's login, so they go with it; the videos are only deleted on request.
  const notes = await deleteNotes({ stack, sub });
  let deleted = 0;
  if (deleteVideos) {
    const objects = await listVideoObjects({ stack, sub });
    for (let i = 0; i < objects.length; i += 1000) {
      const chunk = objects.slice(i, i + 1000).map((o) => ({ Key: o.Key }));
      await s3.send(new DeleteObjectsCommand({ Bucket: BucketName, Delete: { Objects: chunk, Quiet: true } }));
      deleted += chunk.length;
    }
  }
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId, Username: normalizeUsername(username) }));
  return { sub, deleted, notes };
}

/** Finds ffmpeg/ffprobe on PATH (or via FFMPEG_PATH / FFPROBE_PATH). Returns null if missing. */
export function findTool(name) {
  const candidate = process.env[`${name.toUpperCase()}_PATH`] || name;
  const res = spawnSync(candidate, ['-version'], { stdio: 'ignore' });
  return res.status === 0 ? candidate : null;
}

/** Asks for a value on the terminal without echoing it (used for passwords). */
export function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(question);
    };
    rl.question(question, (answer) => {
      rl.output.write('\n');
      rl.close();
      resolve(answer);
    });
  });
}

export async function passwordFromArgs(values, label = 'Password') {
  if (values.password) return values.password;
  const first = await promptHidden(`${label}: `);
  const second = await promptHidden(`${label} (again): `);
  if (first !== second) throw new Error('The passwords do not match.');
  return first;
}

/** Runs a script's main(), printing a clean error instead of a stack trace. */
export function run(main, usage) {
  main().catch((err) => {
    if (err?.name === 'UsageError') console.error(usage);
    else console.error(`Error: ${err?.name && err.name !== 'Error' ? `${err.name}: ` : ''}${err?.message ?? err}`);
    process.exitCode = 1;
  });
}

export function usageError() {
  const err = new Error('usage');
  err.name = 'UsageError';
  return err;
}
