## Product Vision 
FOR aspiring writers and students in the English language
WHO need a clear roadmap of their linguistic blind spots, rather than just a quick fix for typos
THE Write Up product is a personalized writing mentor and diagnostic dashboard
THAT builds a "Linguistic Profile" of your writing habits over time, identifying deep-seated patterns in syntax, tone, and vocabulary
UNLIKE Grammarly, which acts as an automated editor focused on the "now" or instant corrections
OUR PRODUCT acts as a long-term tutor, providing pedagogical feedback. It explains the logic behind the error and tracks the user's specific history of mistakes to ensure mastery.
POWERED BY Recursive Linguistic Diagnostics (RLD) that track more complex syntax and user-specific writing patterns and Generative Adaptive Learning to create practice activities based on the user's writing style.

## Stakeholders 
Write Up’s users include college students that write and edit with the web app. They are likely to take the advice that Write Up provides at face value, unless there are blatant inconsistencies. This could be harmful if the app is giving incorrect or abrasive feedback.
Write Up’s non-users include teachers and peers who might read work that has gone through the editing advice. They will be subject to work that Write Up has deemed as “correct” without ever interacting with the web app themselves. This could be harmful if the app is making malicious or harmful suggestions, leading to the spread of harmful content.

## Potential Harms 
Harm: Users writing sensitive or personal content may have their private information stored, analyzed, or unintentionally exposed through the AI system. This could make users uncomfortable sharing personal stories, health information, or confidential work documents.
Principle: 3.12 “Work to develop software and related documents that respect the privacy of those who will be affected by that software.”
Mitigation: The team has implemented a Privacy Page in the web app that clearly explains what user data is being collected, stored, and how it is used within the service. This improves transparency so users can better understand how their writing data interacts with the AI system. Before demo night, the team would also like to add a feature allowing users to delete their stored data from Firebase, giving users more control over their personal information.


Harm: Users may lose parts of their personal writing style or voice if the AI provides suggestions that replace unique phrases, wording, or expressions that the system does not recognize. In addition, biased AI suggestions could influence how users write about certain topics, leading to less authentic or unfairly framed content.
Principle: 4.02 “Only endorse documents either prepared under their supervision or within their areas of competence and with which they are in agreement.”
Mitigation: We have implemented options that allow users to decline suggestions provided by the Coaching AI so that users maintain control over their own writing. Before demo night, we want the Coaching AI to learn from declined suggestions and reduce recommending similar types of corrections in the future. If we had additional development time, we would also like users to provide explanations for why they dislike certain suggestions so the AI can better adapt to their writing style and preferences.

Harm: Users who are writing about sensitive information, or are using writing through Write Up to process difficult situations in their lives might receive feedback that exacerbates or ignores their situation. For example, if a user is writing about their issues with depression, it would be better if Write Up didn’t ignore warning signs of mental health crisis, and didn’t provide harsh feedback on an attempt to process difficult emotions.
Principle: 1.05 “Cooperate in efforts to address matters of grave public concern caused by software, its installation, maintenance, support or documentation.”
Mitigation: Issues of harsh feedback should be avoided by the core design of the model, which is meant to be supportive per our main mission. We likely won’t have time to implement a content filter, but it would be nice to filter for topics that elicit concern, and recommend relevant resources to the user if they may need help that Write Up isn’t equipped to provide. 

## One Concrete Change 
One specific decision the team made based on ethical reasoning was to add a detailed Privacy Page to the Write Up web application. This page clearly explains what user data may be collected, processed, and stored, including Google account identifiers, writing samples, feedback history, interaction context, and AI processing information. By providing transparency about how the AI system uses and stores user data, the team allows users to make informed decisions about whether they want to use the platform and consent to its data practices, helping users feel more comfortable and aware when interacting with the application.
