// Integration tests against a deployed stack (default: laguitarrita-students-test).
// Creates two throwaway students A and B, uploads videos for A, and checks that
// B can never see or download A's videos and that missing/invalid tokens get 401.
//
//   STUDENTS_STACK=laguitarrita-students-test node --test tests/
process.env.STUDENTS_STACK ||= 'laguitarrita-students-test';

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthenticationDetails, CognitoUser, CognitoUserPool } from 'amazon-cognito-identity-js';
import {
  AdminGetUserCommand,
  DescribeUserPoolClientCommand,
  DescribeUserPoolCommand,
  UpdateUserAttributesCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  cognito,
  createStudent,
  deleteStudent,
  findTool,
  listVideoObjects,
  normalizeUsername,
  stackOutputs,
} from '../scripts/lib.mjs';

const STACK = process.env.STUDENTS_STACK;
const ORIGIN = 'https://laguitarrita.ch';
const scriptsDir = fileURLToPath(new URL('../scripts/', import.meta.url));
const runId = randomBytes(4).toString('hex');
const studentA = { username: `test-a-${runId}`, password: `pw-a-${runId}` };
const studentB = { username: `test-b-${runId}`, password: `pw-b-${runId}` };

let out;
let workDir;
let tokenA;
let tokenB;

function login({ username, password }) {
  const pool = new CognitoUserPool({ UserPoolId: out.UserPoolId, ClientId: out.UserPoolClientId });
  const user = new CognitoUser({ Username: username, Pool: pool });
  return new Promise((resolve, reject) =>
    user.authenticateUser(new AuthenticationDetails({ Username: username, Password: password }), {
      onSuccess: (session) => resolve(session.getAccessToken().getJwtToken()),
      onFailure: reject,
      newPasswordRequired: () => reject(new Error('unexpected newPasswordRequired challenge')),
    }),
  );
}

const api = (path, token, init = {}) =>
  fetch(`${out.ApiUrl}${path}`, {
    ...init,
    headers: { origin: ORIGIN, ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
  });

function makeVideo(file, size) {
  const ffmpeg = findTool('ffmpeg');
  const res = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=${size}:rate=25`,
    '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
  assert.equal(res.status, 0, 'ffmpeg could not create the test video');
}

function forgeJwt(claims) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'RS256', kid: 'forged', typ: 'JWT' });
  const payload = b64(claims);
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

const decode = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());

before(async () => {
  out = await stackOutputs(STACK);
  assert.ok(findTool('ffmpeg') && findTool('ffprobe'), 'ffmpeg and ffprobe are required for the tests');
  studentA.sub = await createStudent({ stack: STACK, ...studentA });
  studentB.sub = await createStudent({ stack: STACK, ...studentB });

  workDir = mkdtempSync(join(tmpdir(), 'laguitarrita-test-'));
  makeVideo(join(workDir, 'clase-720p.mp4'), '1280x720'); // must be re-encoded to 480p
  makeVideo(join(workDir, 'clase-360p.mp4'), '640x360'); // must be uploaded unchanged
  const upload = spawnSync(process.execPath, [join(scriptsDir, 'upload-videos.mjs'), '--username', studentA.username,
    '--stack', STACK, workDir], { encoding: 'utf8' });
  assert.equal(upload.status, 0, upload.stderr);

  [tokenA, tokenB] = await Promise.all([login(studentA), login(studentB)]);
});

after(async () => {
  for (const s of [studentA, studentB]) {
    if (s.sub) await deleteStudent({ stack: STACK, username: s.username, deleteVideos: true }).catch(() => {});
  }
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

describe('authentication', () => {
  test('request without token gets 401', async () => {
    assert.equal((await api('/videos')).status, 401);
  });

  test('garbage token gets 401', async () => {
    assert.equal((await api('/videos', 'not-a-jwt')).status, 401);
  });

  test('token signed with a foreign key gets 401', async () => {
    const forged = forgeJwt({ ...decode(tokenA), exp: Math.floor(Date.now() / 1000) + 600 });
    assert.equal((await api('/videos', forged)).status, 401);
  });

  test('token with tampered payload (sub of A, signature of B) gets 401', async () => {
    const [header, , signature] = tokenB.split('.');
    const payload = Buffer.from(JSON.stringify({ ...decode(tokenB), sub: studentA.sub })).toString('base64url');
    assert.equal((await api('/videos', `${header}.${payload}.${signature}`)).status, 401);
  });

  test('wrong password is rejected by Cognito', async () => {
    await assert.rejects(login({ username: studentA.username, password: 'wrong-password' }), { code: 'NotAuthorizedException' });
  });
});

describe('user pool (pseudonymous usernames)', () => {
  test('sign-in by username only: no e-mail/phone, no required attributes, no verification, no sign-up', async () => {
    const { UserPool: pool } = await cognito.send(new DescribeUserPoolCommand({ UserPoolId: out.UserPoolId }));
    assert.equal(pool.UsernameAttributes, undefined);
    assert.equal(pool.AliasAttributes, undefined);
    assert.deepEqual(pool.AutoVerifiedAttributes ?? [], []);
    assert.deepEqual(pool.SchemaAttributes.filter((a) => a.Required).map((a) => a.Name), ['sub']);
    assert.equal(pool.UsernameConfiguration.CaseSensitive, false);
    assert.equal(pool.AdminCreateUserConfig.AllowAdminCreateUserOnly, true);
    assert.equal(pool.Policies.PasswordPolicy.MinimumLength, 8);
    const { UserPoolClient: client } = await cognito.send(
      new DescribeUserPoolClientCommand({ UserPoolId: out.UserPoolId, ClientId: out.UserPoolClientId }),
    );
    assert.deepEqual(client.WriteAttributes, ['updated_at']);
  });

  test('students only have a username and a sub', async () => {
    const user = await cognito.send(new AdminGetUserCommand({ UserPoolId: out.UserPoolId, Username: studentA.username }));
    assert.deepEqual(user.UserAttributes.map((a) => a.Name), ['sub']);
  });

  test('students cannot add an e-mail or name to their own profile', async () => {
    for (const Name of ['name', 'email', 'given_name', 'phone_number']) {
      await assert.rejects(
        cognito.send(new UpdateUserAttributesCommand({ AccessToken: tokenA, UserAttributes: [{ Name, Value: 'x' }] })),
        { name: 'NotAuthorizedException' },
        Name,
      );
    }
  });

  test('usernames are case-insensitive at sign-in', async () => {
    const token = await login({ username: studentA.username.toUpperCase(), password: studentA.password });
    assert.equal(decode(token).sub, studentA.sub);
  });

  test('only simple usernames are accepted by the scripts', () => {
    assert.equal(normalizeUsername('  Student.A_1-x '), 'student.a_1-x');
    for (const bad of ['ab', 'a'.repeat(33), 'user@example.com', 'two words', 'ümlaut', '']) {
      assert.throws(() => normalizeUsername(bad), /username/);
    }
  });
});

describe('isolation', () => {
  test('A sees exactly their own videos with working play and download URLs', async () => {
    const res = await api('/videos', tokenA);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
    const { videos, expiresIn } = await res.json();
    assert.equal(expiresIn, 3600);
    assert.deepEqual(videos.map((v) => v.name).sort(), ['clase-360p.mp4', 'clase-720p.mp4']);

    for (const v of videos) {
      assert.ok(v.playUrl.includes(`students/${studentA.sub}/videos/`));
      assert.match(v.playUrl, /X-Amz-Expires=3600/);
      const play = await fetch(v.playUrl, { headers: { range: 'bytes=0-1023', origin: ORIGIN } });
      assert.equal(play.status, 206, 'range requests must work for seeking');
      assert.equal(play.headers.get('access-control-allow-origin'), ORIGIN);
      await play.arrayBuffer();
      const dl = await fetch(v.downloadUrl);
      assert.equal(dl.status, 200);
      assert.match(dl.headers.get('content-disposition'), /^attachment; filename="clase-\d+p\.mp4"/);
      assert.equal((await dl.arrayBuffer()).byteLength, v.size);
    }
  });

  test('uploads: >480p is re-encoded to 480p with faststart, <=480p is kept unchanged', async () => {
    const { videos } = await (await api('/videos', tokenA)).json();
    const ffprobe = findTool('ffprobe');
    const probe = (url) =>
      spawnSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0', url],
        { encoding: 'utf8' }).stdout.trim();
    const byName = Object.fromEntries(videos.map((v) => [v.name, v]));
    assert.equal(probe(byName['clase-720p.mp4'].playUrl), '480');
    assert.equal(probe(byName['clase-360p.mp4'].playUrl), '360');
    // +faststart puts the moov atom before mdat, so the first box after ftyp is moov.
    const head = Buffer.from(await (await fetch(byName['clase-720p.mp4'].playUrl, { headers: { range: 'bytes=0-63' } })).arrayBuffer());
    const ftypSize = head.readUInt32BE(0);
    assert.equal(head.subarray(ftypSize + 4, ftypSize + 8).toString(), 'moov');
  });

  test('B gets an empty list', async () => {
    const res = await api('/videos', tokenB);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).videos, []);
  });

  test("B cannot reach A's folder through query string, path or headers", async () => {
    for (const path of [`/videos?sub=${studentA.sub}`, `/videos?prefix=students/${studentA.sub}/videos/`]) {
      const res = await api(path, tokenB, { headers: { 'x-user-sub': studentA.sub } });
      assert.equal(res.status, 200);
      assert.deepEqual((await res.json()).videos, []);
    }
    assert.equal((await api(`/videos/${studentA.sub}`, tokenB)).status, 404);
  });

  test('objects are private and a presigned URL cannot be re-pointed to another key', async () => {
    const objects = await listVideoObjects({ stack: STACK, sub: studentA.sub });
    assert.ok(objects.length > 0);
    const key = objects[0].Key;
    // Plain unsigned access to the private bucket.
    const direct = await fetch(`https://${out.BucketName}.s3.${out.Region}.amazonaws.com/${key}`);
    assert.equal(direct.status, 403);
    // Re-using a valid signature with another key fails the signature check.
    const { videos } = await (await api('/videos', tokenA)).json();
    const url = new URL(videos[0].playUrl);
    url.pathname = `/students/${studentB.sub}/videos/${videos[0].name}`;
    assert.equal((await fetch(url)).status, 403);
  });

  test('CORS preflight allows laguitarrita.ch and rejects other origins', async () => {
    const preflight = (origin) =>
      fetch(`${out.ApiUrl}/videos`, {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
      });
    const ok = await preflight(ORIGIN);
    assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
    const bad = await preflight('https://evil.example');
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });
});
