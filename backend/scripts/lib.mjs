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
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

export const REGION = process.env.AWS_REGION || 'eu-central-1';
export const DEFAULT_STACK = process.env.STUDENTS_STACK || 'laguitarrita-students';

export const cognito = new CognitoIdentityProviderClient({ region: REGION });
export const s3 = new S3Client({ region: REGION });

const outputsCache = new Map();

/** Reads UserPoolId, UserPoolClientId, BucketName and ApiUrl from the stack outputs. */
export async function stackOutputs(stackName = DEFAULT_STACK) {
  if (!outputsCache.has(stackName)) {
    const cfn = new CloudFormationClient({ region: REGION });
    const { Stacks } = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
    const outputs = Object.fromEntries((Stacks[0].Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
    outputsCache.set(stackName, outputs);
  }
  return outputsCache.get(stackName);
}

export const normalizeEmail = (email) => String(email ?? '').trim().toLowerCase();

export function assertPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('The password must be at least 8 characters long.');
  }
}

export const videosPrefix = (sub) => `students/${sub}/videos/`;

export async function createStudent({ stack, email, name, password }) {
  const { UserPoolId } = await stackOutputs(stack);
  email = normalizeEmail(email);
  assertPassword(password);
  const attributes = [
    { Name: 'email', Value: email },
    { Name: 'email_verified', Value: 'true' },
  ];
  if (name) attributes.push({ Name: 'name', Value: name });
  const { User } = await cognito.send(
    new AdminCreateUserCommand({
      UserPoolId,
      Username: email,
      UserAttributes: attributes,
      MessageAction: 'SUPPRESS', // never send the Cognito invitation e-mail
    }),
  );
  await setPermanentPassword({ stack, email, password, signOut: false });
  return User.Attributes.find((a) => a.Name === 'sub').Value;
}

export async function setPermanentPassword({ stack, email, password, signOut = true }) {
  const { UserPoolId } = await stackOutputs(stack);
  assertPassword(password);
  const Username = normalizeEmail(email);
  await cognito.send(new AdminSetUserPasswordCommand({ UserPoolId, Username, Password: password, Permanent: true }));
  // Invalidate refresh tokens issued with the old password.
  if (signOut) await cognito.send(new AdminUserGlobalSignOutCommand({ UserPoolId, Username }));
}

export async function getStudent({ stack, email }) {
  const { UserPoolId } = await stackOutputs(stack);
  const user = await cognito.send(new AdminGetUserCommand({ UserPoolId, Username: normalizeEmail(email) }));
  const attr = (n) => user.UserAttributes.find((a) => a.Name === n)?.Value;
  return { sub: attr('sub'), email: attr('email'), name: attr('name'), status: user.UserStatus };
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
    const attr = (n) => u.Attributes.find((a) => a.Name === n)?.Value;
    return { sub: attr('sub'), email: attr('email'), name: attr('name') ?? '', created: u.UserCreateDate };
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

export async function deleteStudent({ stack, email, deleteVideos = false }) {
  const { UserPoolId, BucketName } = await stackOutputs(stack);
  const { sub } = await getStudent({ stack, email });
  let deleted = 0;
  if (deleteVideos) {
    const objects = await listVideoObjects({ stack, sub });
    for (let i = 0; i < objects.length; i += 1000) {
      const chunk = objects.slice(i, i + 1000).map((o) => ({ Key: o.Key }));
      await s3.send(new DeleteObjectsCommand({ Bucket: BucketName, Delete: { Objects: chunk, Quiet: true } }));
      deleted += chunk.length;
    }
  }
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId, Username: normalizeEmail(email) }));
  return { sub, deleted };
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
