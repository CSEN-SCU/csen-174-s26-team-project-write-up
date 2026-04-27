# Write Up — Architecture

This document defines a simplified C4 architecture for **Write Up** using **Option B**: split backend services for app flows vs coaching flows. It is aligned with [product-vision.md](../product-vision.md): learning-first feedback, voice preservation, and longitudinal skill growth.

The diagrams use Mermaid C4 syntax (`C4Context`, `C4Container`) and are intentionally minimal for readability.

---

## Level 1 — System Context

```mermaid
C4Context
    title Write Up — System Context

    Person(writer, "Writer / Student", "Writes in everyday tools and uses coaching to improve over time.")
    System(writeup, "Write Up", "Learning-first writing coach with feedback, profile tracking, and practice support.")

    System_Ext(gdocs, "Google Docs", "Primary writing surface for the extension experience.")
    System_Ext(gauth, "Google OAuth", "Authorizes scoped access to Google Docs content.")
    System_Ext(llm, "LLM Provider", "Generates coaching responses and adaptive practice prompts.")

    Rel(writer, writeup, "Uses extension and web app for feedback, profile, and practice")
    Rel(writeup, gdocs, "Reads active document text for analysis")
    Rel(writeup, gauth, "Obtains and refreshes access tokens")
    Rel(writeup, llm, "Sends coaching prompts and receives suggestions")
```

---

## Level 2 — Container Diagram (Option B)

```mermaid
C4Container
    title Write Up — Container Diagram (Option B: App API + Coaching API)

    Person(writer, "Writer / Student", "Drafts text and reviews suggestions.")

    System_Boundary(writeup, "Write Up") {
        Container(extension, "Chrome Extension", "Chrome MV3 (side panel + Docs integration)", "Provides in-context suggestions, issue highlights, and dismiss actions while writing in Google Docs.")
        Container(webapp, "Web App", "React + Vite", "Hosts onboarding, progress history, feedback review, and practice experience.")

        Container(appapi, "App API", "Python Flask", "Handles onboarding Q&A, auth/session integration, feedback history queries, and dismissal/preferences APIs.")
        Container(coachapi, "Coaching API", "Node + Express", "Runs RAG retrieval, writing-level assessment (future), profile updates, and coaching generation.")

        ContainerDb(datastore, "User Data Store", "Firebase (Firestore + Auth)", "Stores users, writing samples, issues, dismissals, profile state, and feedback history.")
        ContainerDb(kb, "Coaching Knowledge Base", "Markdown/text corpus", "Reference material used by RAG for grounded writing feedback.")
    }

    System_Ext(gdocs, "Google Docs", "External writing surface")
    System_Ext(gauth, "Google OAuth", "Scoped Docs authorization")
    System_Ext(llm, "LLM Provider", "External model API")

    Rel(writer, extension, "Writes and receives live coaching")
    Rel(writer, webapp, "Views onboarding, issues, and progress")

    Rel(extension, coachapi, "Requests live coaching and sends dismiss signals")
    Rel(extension, appapi, "Reads/stores issue history for sidebar display")
    Rel(extension, gdocs, "Reads active doc content")

    Rel(webapp, appapi, "Onboarding, dashboard, and history APIs")
    Rel(webapp, coachapi, "Submits baseline writing sample (future)")

    Rel(appapi, datastore, "Reads/writes user state and feedback history")
    Rel(appapi, gauth, "Manages Google OAuth token flow")
    Rel(coachapi, datastore, "Reads/writes profile, issue trends, and outcomes")
    Rel(coachapi, kb, "Retrieves relevant guidance chunks")
    Rel(coachapi, llm, "Generates coaching output")
    Rel(appapi, gauth, "Manages OAuth token flow")
```

---

## Scope Notes

- MVP flow: extension + web app + split APIs + shared Firebase data layer.
- Stretch goals are represented as `(future)` behavior inside existing containers, not extra boxes.
- Recommended evolution path: add an async profile worker later if reassessment/pruning workloads grow.
