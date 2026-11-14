
# LMS Education Application

The LMS Education Application is a fully offline learning management system (LMS) for schools that cannot depend on internet access.

The application will run on a local network hosted by a Raspberry Pi. Students and teachers will connect to the Raspberry Pi through local Wi-Fi provided by the Raspberry Pi or an attached wireless router. The client application will be built with React Native and will communicate with the local server over the school’s local network.

Internet access is not required for installation, login, classroom use, assignment submission, grading, backups, or normal maintenance. The Raspberry Pi will be the local source of truth for the school’s data.

## Problem
Many students and teachers cannot reliably use online classroom platforms because internet access may be unavailable, expensive, slow, or inconsistent. **This makes it difficult to:**
- distribute assignments and learning materials
- keep track of deadlines
- submit work on time
- provide feedback
- maintain a reliable classroom calendar
- preserve student records

The application will provide these core classroom functions over a local network, without requiring the school to be connected to the internet. This will reduce the financial and operational strain of maintaining a constant internet connection.

## Goals
Our goals are to create a reliable, fully offline LMS application. This project will focus on the React Native client application and the local server that runs on the Raspberry Pi. Additional goals include:
- Host the application and classroom data on a Raspberry Pi.
- Allow students and teachers to connect using local Wi-Fi (provided by Raspberry Pi).
- Provide a shared calendar for classes and school events.
- Allow teachers to create, receive, grade, and return assignments.
- Allow students to complete and submit assignments.
- Make submission and grading status clear to both students and teachers.
- Store data reliably on the local server.
- Keep the initial application simple enough to deploy and maintain in a school.

## Users and roles
### Students
Students can:
- view their classes
- view assignments and due dates
- view classroom and school events
- download assignment instructions and attached resources
- complete assignments
- save unfinished work
- submit assignments
- view submission status
- view grades and teacher feedback
- resubmit work when a teacher permits it.

### Teachers
Teachers can:
- create and manage classes
- enroll or remove students
- create assignments
- attach instructions and reference files
- set due dates and submission rules
- create calendar events
- view submitted work
- grade assignments
- provide written feedback
- return work to students
- allow or reject resubmissions
- view which students have not submitted an assignment.

### Administrators
An administrator role may be added to manage the local installation. Administrators could:
- create teacher and student accounts
- configure the school and Raspberry Pi server
- manage classes and user access
- back up and restore application data; and
- view server health and available storage.

## Technical architecture

### React Native client application

The student and teacher application will be built with React Native. React Native is a suitable choice because it can support Android and iOS devices from a shared codebase and can provide a consistent interface for phones and tablets.

The client application should:

- connect to the Raspberry Pi over the local network;
- work with no internet connection;
- cache required classroom data locally;
- allow students to prepare work before reconnecting to the local server;
- maintain a queue for pending uploads;
- show whether data is saved locally or stored on the server;
- retry interrupted transfers safely; and
- support role-specific student, teacher, and administrator interfaces.

The first target should be Android phones and tablets because they are commonly available and generally less expensive. iOS support can be added or maintained if the target schools have Apple devices. A desktop client or React Native Web client can be considered later for schools that primarily use computers.

### Raspberry Pi local server

The Raspberry Pi will host the local API, database, file storage, and local network services. The React Native application will communicate with the server using the school’s local Wi-Fi.

The server may be implemented as a lightweight local service with a relational database and a file-storage directory. The server must remain usable even when the school has no internet service.

### Offline installation and updates

The system must be installable and maintainable without internet access. The Raspberry Pi server software, database, and initial configuration should be transferable by USB drive or local computer. React Native application packages should be installable on supported devices through locally provided application packages or a school-managed device deployment process.

Updates should be distributed locally, for example through a USB drive or administrator device connected to the Raspberry Pi. Updating the application must not require access to an online app store or external package repository.

### Local data flow

```text
React Native student/teacher apps
              |
        Local Wi-Fi network
              |
      Raspberry Pi local server
       |       |        |
   Database  Files   Backups
```

The Raspberry Pi is the authoritative source for class rosters, assignments, submissions, grades, feedback, and calendar events. A client may temporarily store unfinished work, but completed submissions are not considered submitted until the Raspberry Pi confirms receipt.

## Core features
### 1. Local classroom server
The Raspberry Pi will host the application server and database. Devices connected to the school’s local Wi-Fi will use the LMS without internet access.

**The server should provide:**
- user authentication and role-based access control
- local storage for assignments and submissions
- database backups (if storage permits)
- basic storage monitoring
- safe shutdown and recovery procedures.

The system must run without internet access. No feature in the initial release may require an external website, cloud account, online authentication provider, or internet connection.

### 2. Calendar
The calendar is one of the primary features of the application. It should show:
- assignment due dates
- quizzes and exams;
- class event
- school events
- holidays and planned closures
- teacher-created reminders

Calendar events should be visible based on the user’s role and class membership. Students should be able to select an event and view related assignment details.

  

### 3. Assignments
Teachers should be able to create an assignment with:
- title
- description and instructions
- class or student recipients
- creation date
- due date and optional due time
- allowed submission types
- attached reference files
- resubmission rules.

Students should be able to see whether an assignment is upcoming, due soon, submitted, late, graded, or returned for revision.

  

### 4. Assignment submissions
The initial release should support the following submission types:

#### Documents
Students can upload common document formats such as PDF, DOCX, and plain text files. The system should preserve the original file and record the submission time.

#### Photos and images
Students can upload photographs of handwritten work, projects, diagrams, or physical assignments. Supported image formats should initially include JPEG and PNG. The application should also have a scan document mode using the device camera where supported.

#### In-app text editor
Students can write short- and medium-length responses directly in the application. This is useful when students do not have access to a word processor.

#### Quizzes
Teachers can create basic quizzes containing multiple-choice, true/false, and short-answer questions. The first version should focus on storing responses and allowing teachers to review them. Automatic grading can be limited to objective question types, and if time permits.

#### Future submission types
The following may be considered later:
- spreadsheets
- presentations
- audio recordings
- video recordings
- offline collaborative documents.

Large media files should not be prioritized until storage, upload reliability, and Raspberry Pi performance have been tested.

### 5. Grading and feedback
Teachers should be able to:
- assign a numeric or letter grade
- add written feedback
- mark an assignment as reviewed
- return an assignment to the student
- request a revision
- allow a student to resubmit.
- 
Students should be able to view the grade and feedback after the teacher returns the submission.

### 6. Status and reliability indicators
The interface should clearly display the state of student work:
- Not started
- In progress
- Ready to submit
- Submitted
- Late submission
- Graded
- Revision requested
 
Because the application is fully offline and local-first, the word “submitted” should mean that the Raspberry Pi has received and stored the work successfully. The student should receive a visible confirmation and a submission receipt or timestamp. “Saved locally” must be a separate status from “Submitted.”

## Access without a personal phone
Students should not be required to own a phone. The application can support several access methods:
1.  **School-owned computers or tablets** — Students log in from shared devices connected to the school Wi-Fi.
2.  **Computer lab or classroom kiosk** — A teacher can provide scheduled access to one or more shared devices.
3.  **Student-owned low-cost devices** — Any supported Android or iOS phone or tablet can connect when available.
4.  **Teacher-assisted submission** — A teacher can upload physical work or enter a submission on behalf of a student when necessary.

Shared devices must support logout, automatic session expiration, and separation of one student’s files from another student’s account.

## Local synchronization model

For this project, synchronization means transferring data between a React Native device and the local Raspberry Pi server. It does not require, and must not depend on, a cloud service or internet connection.

The expected workflow is:
1. A teacher creates an assignment on the local server.
2. Students connect to the local network and download the assignment.
3. Students work on the assignment in the React Native application.
4. If the student temporarily leaves the local network, the application saves progress on the device.
5. The student reconnects to the school’s local Wi-Fi.
6. The application uploads the completed work to the Raspberry Pi.
7. The server confirms receipt and updates the assignment status.
8. The teacher reviews, grades, and returns the work.

The application must maintain a local outbox of pending changes and retry failed uploads without creating duplicate submissions. A submission should have a unique identifier so that interrupted uploads can safely resume or be retried.

## Raspberry Pi deployment considerations
The deployment should account for:
- local Wi-Fi availability;
- Raspberry Pi storage capacity;
- SD-card failure;
- power interruptions;
- backup and restore;
- multiple simultaneous users;
- file upload limits;
- account security; and
- maintenance by someone with limited technical experience.

The system should use an external storage device or scheduled backup process for important data. A Raspberry Pi should not be treated as the only permanent copy of student records.

## Recommended MVP
The minimum viable product should include:
- student, teacher, and administrator accounts
- local login through the React Native application
- class creation and enrollment
- calendar events
- assignment creation
- PDF, document, image, and text submissions
- basic quizzes
- submission confirmation
- teacher grading and written feedback
- assignment status tracking
- local database and file backups

Native support for additional platforms, advanced quizzes, and large media uploads should be evaluated after the local workflow is reliable. Internet connectivity and cloud synchronization are not requirements for the MVP.

## Open questions
- Will the Raspberry Pi provide the school’s Wi-Fi directly, or will it connect to an existing local router?
- Will the first release target Android only, or Android and iOS?
- Should a desktop client be supported for school-owned computers?
- How many simultaneous users must one Raspberry Pi support?
- What happens when a student shares a computer with another student?
- Should students be allowed to submit late work?
- Can students revise an assignment after submission?
- What file formats are required by the target schools?
- How will the system handle a full storage device?
- How frequently should the server back up data?
- Should teachers be able to export grades and submissions to a USB drive?
- How will a school recover data if the Raspberry Pi is damaged or lost?
- What languages and accessibility features are required?
- How will devices discover the Raspberry Pi on the local network?
- How will a new device receive the school’s local server address and security certificate?
- How will the application handle a student moving between multiple Raspberry Pi servers?

## Success criteria
The first release will be successful if a school can:
- install the application on a Raspberry Pi
- connect student and teacher devices without internet access
- create users and classes
- distribute assignments over local Wi-Fi
- receive student submissions without internet access
- grade and return assignments
- view assignment deadlines on a calendar
- restore the school’s data from a backup after a server failure.
