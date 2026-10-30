// Public identifiers of the student-area backend (backend/template.yaml outputs).
// None of these are secrets: the user pool client has no secret and every API call
// needs a valid Cognito token.
export const STUDENT_CONFIG = {
  region: 'eu-central-1',
  userPoolId: 'eu-central-1_ayxyse307',
  userPoolClientId: '741nni16td0vkijj67cv7aqbkk',
  apiUrl: 'https://p2ttsvsi4l.execute-api.eu-central-1.amazonaws.com',
} as const;
