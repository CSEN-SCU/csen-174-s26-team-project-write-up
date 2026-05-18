## Fix 1: Adding Rate Limits to AI Calls

Peer Report: See “Fix 1” here: https://docs.google.com/document/d/1jcMqh3nsy5etzNfa1lNk878fpLyky9aiOOcDWdAKKuk/edit?usp=sharing 

Merged PR: https://github.com/CSEN-SCU/csen-174-s26-team-project-write-up/commit/fe64b2882a87992534931a5c5239757f58360e55 

Description: Originally, the Coaching API endpoints did not implement rate limiting, allowing repeated requests to continuously trigger paid Groq API calls, creating a security risk, as malicious users could abuse the endpoint to intentionally consume API quotas and backend resources. To address this issue, we implemented a custom RateLimitExceeded error handler that returns a 429 Too Many Requests response with an error message when clients exceed the allowed request threshold, as well as a flask-limiter middleware to the app-api service to restrict /coach requests to a fixed number per minute per user/IP. 



## Fix 2: Adding Internal Authentication

Peer Report: See “Fix 2” here: https://docs.google.com/document/d/1jcMqh3nsy5etzNfa1lNk878fpLyky9aiOOcDWdAKKuk/edit?usp=sharing 

Merged PR: https://github.com/CSEN-SCU/csen-174-s26-team-project-write-up/commit/4fe60a61bec38e3642e6f3e56ce99bb984159c7a 

Description: Our API calls now require correct internal shared secrets to be provided in order to function, allowing only trusted internal services to use it. This prevents API calls without the appropriate credentials from going through, preventing malicious users from accessing the coaching service at the endpoint. 