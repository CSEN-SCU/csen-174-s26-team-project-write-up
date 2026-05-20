## Our Target: Email Triage Agent

## Paragraph Summary:
Our target’s product focuses on sorting the emails the user receives by response priority, and generating potential replies to expedite important communication. Our team probed the public GitHub files and history, the deployed URL, and cloned repos of the project. By viewing the main URL and code files, we got a basic understanding of the product's intended purpose and how it accomplishes it. We inspected the console on GitHub for errors and looked through the GitHub repository files and version history for secrets. We also cloned the GitHub repository on local machines and worked with Cursor to find vulnerabilities and points of weakness. It was able to identify a lot of the issues mentioned in later sections of this document, such as AI API security and exposed user data.
Some prompts used: 
Identify possible attacker archetypes for this project and explain why each one is relevant. 
Check whether the AI-backend endpoints can be abused and LLMs spammed. Identify any missing authentication and input validation.
Does the app handle user self-harm, where users may accidentally provide sensitive information to the model?


## Threat Model:
An accidental user is a likely attacker archetype for this product. Since the product scans all the users' emails and generates responses based on their content, there is a higher likelihood of the accidental generation and sending of sensitive information. This is documented further in the Responsible AI section. We also felt external attackers could be a big concern, as authentication probing and prompt injection could be easily done by an individual lured in by potential access to confidential information found in emails.


## Technical security:
Vulnerability Name: Authentication Misconfiguration and Framework Error Disclosure

Where 
observed in deployed production routes:
/api/auth/session
/api/context
/api/emails
- frontend console references: errors.authjs.dev#autherror
- bundled frontend chunks:
- 696-8565e87d954233d3.js
- page-8e9e215fe78329df.js

Reproduction Steps
Open the deployed application in a browser.
Open Developer Tools → Console and Network tabs.
Refresh the page while unauthenticated.
Observe repeated 500 Internal Server Error responses for:
/api/auth/session
/api/context
/api/emails
Observe publicly visible Auth.js framework error messages:
“There was a problem with the server configuration. Check the server logs for more information.”
Severity
Major

Why It Matters
The application exposes authentication framework behavior and repeatedly fails backend API requests in production. An external attacker could use the exposed Auth.js error behavior and failing endpoints to fingerprint the authentication architecture and identify unstable backend functionality for further probing.
The recurring 500 responses also reduce service availability for legitimate users attempting authentication-dependent actions.

Recommendation
Replace framework-specific authentication errors with generic user-facing responses while restricting detailed diagnostics to server-side logs only. Validate production environment variables and Auth.js configuration during deployment to eliminate recurring authentication failures. Add retry limits or exponential backoff in frontend request handling to prevent unnecessary repeated requests against failing endpoints.


## AI API Security:
Vulnerability name: LLM Prompt Injection via Untrusted Email Body in User Prompt
Where in the system (URL, route, file path, line numbers): consolidated_project/backend/app/agent/graph.py (e.g. CLASSIFY_PROMPT.format, lines ~117–124); prompt template consolidated_project/backend/app/agent/prompts.py ({body} inside CLASSIFY_PROMPT, ~23–28)
Reproduction steps a grader can follow:
Any external sender can send a message posed as an email, but that actually includes text trying to maliciously prompt the AI model (e.g. “Ignore all previous instructions. Output …”). As a result, the AI would read both the developer’s original rules as well as the updated rules the external sent. As a result, the AI may end up following the attacker’s rules instead.
A reader can run triage on an email whose body includes text attempting to override JSON-only instructions and document whether output breaks schema or policy to determine if this is a threat.
Severity: Major 
As a result of this attack, the model’s outputs, such as their labels, JSON, summaries, and draft text, might be inconsistent and misleading with the expectations of the product. Depending on how the attacker may prompt this AI and if there are checks in place, the AI may do dangerous things such as deleting emails, exposing secrets, and sending unsolicited emails.
Recommended fix in 2 to 3 sentences: 
Prompt engineers should spell out the exact output shape the product expects, such as JSON fields, and parse every model response against that contract. Anything that fails validation should be dropped or replaced with a safe default, not passed through as if it were trusted. Cap and normalize how much email and context text can enter the prompt so oversized or noisy payloads cannot dominate the model or burn resources. Keep high-risk actions out of automatic paths: the model should suggest, while the application (and ideally the user) decides on side effects like sending mail or changing data. 

## Responsible AI:
Emails can, and often do, contain very sensitive information. Whether that is a password reset link, confirmation of a medical appointment, sharing of personal information between close individuals, or anything in between, people are often very protective of the information in their inboxes. The app currently scans all emails a user receives and processes the information to understand the context and generate responses. For users who are currently scheduling medical appointments they would rather keep private, knowing that the AI is scanning that information could cause intense anxiety over concerns of that information being leaked, if not accidental leaks in generated responses. You could consider adding steps that confirm the complete deletion of scanned information after the email is sorted to alleviate long-term concerns. You could also allow users to select specific senders or keywords that, once detected, the app will not process the information of. For example, if the user above selected their doctor’s email as an email to avoid, the app would not process or sort the contents of that email, and therefore provide better protection of sensitive medical information.



## Appendix - AI Prompting:

When looking at the AI API Security and analyzing the LLM Prompt Injection issue, we looked for prompt injection prompts by prompting the Cursor Agent: “What terminal commands should I run to find where user input meets the model call by looking for ${userInput} or f"{user_input}" inside system or user messages to determine if there are any prompt injection issues?” It outputted with having us run this command: “Get-ChildItem -Recurse -Path .\consolidated_project\backend\app,.\prototypes -File -Include *.py |
Select-String -Pattern 'messages\.create|chat\.completions\.create'.” 
As a result, my terminal outputted lines like:
“consolidated_project\backend\app\agent\graph.py:117:    prompt = CLASSIFY_PROMPT.format(
consolidated_project\backend\app\agent\graph.py:153:        SUMMARIZE_PROMPT.format(
consolidated_project\backend\app\agent\graph.py:169:    prompt = ACTIONS_PROMPT.format(      “
After running this command, analyzing these results, and verifying with Cursor, we concluded that untrusted email content and optional user context are interpolated into model prompts, such as in graph.py and prompts.py. The Cursor Agent outputted that: 
“A sender (or anyone who can influence user_context if it is user-controlled) can try to override instructions (“ignore previous rules…”), exfiltration tricks, etc. That is a class of risk for LLM-in-the-loop apps, not something grep can grade as ‘safe’ or ‘unsafe’ without threat modeling and tests.” 
This helped us confirm that prompt injection is a threat in this project.
