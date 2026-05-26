## Celebrate 
Our biggest success in this sprint was learning to be adaptable and completely shift gears when necessary. We had a lot of errors when it came to connecting the backend to the frontend, so we needed to make some big changes to our architecture. Chris in particular did a lot of work to do the shift to serverless APIs, setting up the new files and hosting them on Vercel. Another shift we had to make was to move away from the web extension as part of our project. Ishika put in a ton of great work setting up the OAuth and launching the extension on the Chrome Web Store, but ultimately getting the extension functioning live proved to be more testing than we have time for, and Ishika was great about switching her focus to the web app with Cole. Catherine did a bunch of great work setting up our Firebase, making sure authentication and user storage operated correctly. Cole added some important features to the web app, like the history and privacy notice tabs, to help improve the user experience. Finally, Miranda did lots of work on the documentation and review, running a heuristic evaluation on the web app and extension and ensuring everything was written and completed as needed.


## Red Team Response 
We acted on all feedback we got from our red teaming, as they all felt fairly critical to repair. We invalidated exposed APIs, restricted the CORS origin, added authentication to the Coaching API, removed public GET, turned off debug = True, set up rate limiting, made the health info private, and removed extra .env files. All those remediations can be seen in pushes made on May 13th here: https://github.com/CSEN-SCU/csen-174-s26-team-project-write-up/commits/main/ 


## Sprint 3 Commitments 
Closer collaboration and communication on changes. All our UI improvements we want to make before the freeze are being tallied, discussed, and implemented. We want this process to be open to individual creativity, but to fix all of the big errors that team members have noticed, hence the collaborative nature.
KanBan: https://github.com/orgs/CSEN-SCU/projects/18/views/1?pane=issue&itemId=192026912&issue=CSEN-SCU%7Ccsen-174-s26-team-project-write-up%7C86 

Act on errors and concerns quickly. Testing the model and implementing necessary changes will be a collaborative effort in order to provide support on unexpected errors and to better catch potential bugs.
KanBan: https://github.com/orgs/CSEN-SCU/projects/18/views/1?pane=issue&itemId=192028959&issue=CSEN-SCU%7Ccsen-174-s26-team-project-write-up%7C87 
