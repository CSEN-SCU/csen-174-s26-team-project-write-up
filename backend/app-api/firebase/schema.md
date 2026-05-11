# Firestore Schema (MVP)

## users
- userId
- email
- displayName
- createdAt
- updatedAt
- onboardingComplete (boolean, when `POST /onboarding` succeeds)
- onboardingAt (ISO timestamp)
- onboardingWritingSample (string, optional)
- onboardingGoals (optional)
- onboardingExperienceLevel (optional string)

## feedback_history
- userId
- docId
- cardId
- category
- issue
- why
- fixOptions
- sources
- confidence
- createdAt

## dismissals
- userId
- cardId
- category
- reason
- sources
- createdAt

## preferences
- userId
- focusAreas
- tonePreference
- notifications
- updatedAt
