// Public identifiers of the concert admin backend (backend/konzert/template.yaml admin outputs).
// None of these are secrets: the user-pool client has no secret and every /admin call needs a
// valid Cognito access token. This is the private concert-admin pool, separate from the students.
// (Outputs of the prod laguitarrita-konzert stack.)
export const KONZERT_ADMIN_CONFIG = {
  region: 'eu-central-1',
  userPoolId: 'eu-central-1_kA61HA7Zk',
  userPoolClientId: '6j2c6hn49jacqcdkmcul2jn9po',
  apiUrl: 'https://egyep7sdrb.execute-api.eu-central-1.amazonaws.com',
} as const;
