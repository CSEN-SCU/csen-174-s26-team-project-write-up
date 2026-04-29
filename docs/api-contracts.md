# API Contracts (v0)

## Shared Types
- `FeedbackCard`: `shared/types/feedback-card.js`
- `DismissEvent`: `shared/types/dismiss-event.js`

## Coaching API (`http://localhost:8787`)
- `POST /coach`
- `POST /dismiss`
- `GET /profile/:userId`

## App API (`http://localhost:5050`)
- `POST /auth/google`
- `GET /users/me`
- `POST /onboarding`
- `GET /feedback-history?docId=<id>`
- `POST /feedback-history`
- `POST /dismissals`
- `GET /preferences`
- `PUT /preferences`
