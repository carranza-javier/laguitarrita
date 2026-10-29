// Public identifiers of the student-area backend (backend/template.yaml outputs).
// None of these are secrets: the user pool client has no secret and every API call
// needs a valid Cognito token.
export const STUDENT_CONFIG = {
  region: 'eu-central-1',
  userPoolId: 'eu-central-1_2TPqzVZCD',
  userPoolClientId: '2igk6sno4fg1gs1ar219iefjc6',
  apiUrl: 'https://p2ttsvsi4l.execute-api.eu-central-1.amazonaws.com',
} as const;
