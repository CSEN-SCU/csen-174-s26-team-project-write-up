# Firestore Schema (MVP)

## users
- userId
- email
- displayName
- createdAt
- updatedAt

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
