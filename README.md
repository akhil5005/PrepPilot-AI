# PrepPilot AI

PrepPilot AI is a full-stack AI-powered interview preparation platform that helps users create a personalized interview preparation strategy using their resume, target job description, and self-description.

The application analyzes the user's profile and job requirements, then generates a match score, technical interview questions, behavioral interview questions, skill gaps, and a structured preparation roadmap. It also supports resume PDF generation and download.

## Live Demo

Frontend: https://prep-pilot-ai-theta.vercel.app
Backend: https://preppilot-ai-backend.onrender.com

## Features

* User registration and login
* JWT-based authentication
* Resume upload support
* Job description input
* Self-description input
* AI-generated interview preparation report
* Match score generation
* Technical interview questions
* Behavioral interview questions
* Skill gap analysis
* 7-day preparation roadmap
* Recent interview plans history
* Resume PDF generation and download
* Responsive dark-themed user interface
* Full-stack deployment using Vercel and Render

## Tech Stack

### Frontend

* React.js
* React Router
* Axios
* SCSS
* Vite
* Vercel

### Backend

* Node.js
* Express.js
* MongoDB
* Mongoose
* JWT
* Multer
* Puppeteer
* Render

### AI Integration

* Google Gemini API / Google GenAI

## Screenshots

### Register Page

<img width="1544" height="779" alt="register page" src="https://github.com/user-attachments/assets/d076322c-e93f-49f5-874d-250da96ebdcd" />

### Login Page

<img width="1544" height="787" alt="login gen ai app" src="https://github.com/user-attachments/assets/94d0f24d-a208-4fe9-b175-669e7f9db634" />

### Create Interview Plan Page

<img width="1540" height="775" alt="Home Page" src="https://github.com/user-attachments/assets/af18c0ed-7a41-4b39-b22e-c492573d9fbf" />

### Technical Questions Report

<img width="1540" height="775" alt="Technical Questions Report" src="https://github.com/user-attachments/assets/511d4ffd-9a17-443a-aaf9-8a8f045bdb68" />

### Behavioral Questions Report

<img width="1544" height="780" alt="Behavioural Questions Report" src="https://github.com/user-attachments/assets/357c783b-73c8-4405-aecb-5778fe13f69a" />

### Preparation Roadmap

<img width="1540" height="776" alt="Roadmap Report" src="https://github.com/user-attachments/assets/a1f484b0-0fb9-47a8-9c9c-365cfa6da355" />

### Generated Resume PDF

The application also supports AI-generated resume PDF creation and download.

<img width="611" height="680" alt="Screenshot 2026-06-24 233059" src="https://github.com/user-attachments/assets/fc665ad4-414c-4686-a605-3173247a61f4" />

<img width="607" height="526" alt="pdf2" src="https://github.com/user-attachments/assets/bca3b32f-067b-48c7-842a-c1eeda8427a5" />



## How It Works

1. The user registers or logs in.
2. The user enters a target job description.
3. The user uploads a resume or writes a self-description.
4. The backend processes the provided information.
5. The AI model generates a personalized interview preparation report.
6. The user can view technical questions, behavioral questions, skill gaps, match score, and roadmap.
7. The user can download a generated resume PDF.

## Folder Structure

```bash
GENAIAPP/
│
├── Backend/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middlewares/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── services/
│   │   └── app.js
│   │
│   ├── .gitignore
│   ├── package-lock.json
│   ├── package.json
│   └── server.js
│
├── Frontend/
│   ├── public/
│   ├── src/
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   └── interview/
│   │   │
│   │   ├── style/
│   │   │   └── button.scss
│   │   │
│   │   ├── App.jsx
│   │   ├── app.routes.jsx
│   │   ├── main.jsx
│   │   └── style.scss
│   │
│   ├── .gitignore
│   ├── eslint.config.js
│   ├── index.html
│   ├── package-lock.json
│   ├── package.json
│   ├── vercel.json
│   └── vite.config.js
│
└── README.md
```

## Environment Variables

Create a `.env` file inside the `Backend` folder.

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
GEMINI_API_KEY=your_gemini_api_key
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

Create a `.env` file inside the `Frontend` folder.

```env
VITE_API_URL=http://localhost:5000
```

For production, add the deployed backend URL in the frontend environment variable.

```env
VITE_API_URL=https://preppilot-ai-backend.onrender.com
```

## Installation and Setup

### 1. Clone the Repository

```bash
git clone https://github.com/your-github-username/PrepPilot-AI.git
cd PrepPilot-AI
```

### 2. Install Backend Dependencies

```bash
cd Backend
npm install
```

### 3. Start Backend Server

```bash
npm run dev
```

If your backend does not have a `dev` script, use:

```bash
npm start
```

### 4. Install Frontend Dependencies

Open a new terminal.

```bash
cd Frontend
npm install
```

### 5. Start Frontend

```bash
npm run dev
```

The frontend will usually run on:

```bash
http://localhost:5173
```

## API Routes

### Authentication Routes

```http
POST /api/auth/register
POST /api/auth/login
GET /api/auth/logout
GET /api/auth/me
```

### Interview Routes

```http
POST /api/interview
GET /api/interview
GET /api/interview/report/:id
POST /api/interview/resume/pdf/:id
```

## Main Functionalities

### AI Interview Report Generation

PrepPilot AI generates a personalized interview preparation report using the user's resume, job description, and self-description.

The generated report includes:

* Match score
* Technical questions
* Behavioral questions
* Skill gaps
* Preparation roadmap

### Resume PDF Generation

The application can generate a resume PDF based on the user's profile and project information. Users can download the generated PDF directly from the report page.

### Recent Interview Plans

Users can view their previously generated interview preparation plans on the homepage.

## Deployment

### Frontend Deployment

The frontend is deployed on Vercel.

Important points:

* Add `VITE_API_URL` in Vercel environment variables.
* Make sure `vercel.json` is configured for React Router.
* The frontend should call the deployed backend URL in production.

### Backend Deployment

The backend is deployed on Render.

Important points:

* Use dynamic `PORT`.
* Add all backend environment variables in Render.
* Configure CORS using the deployed frontend URL.
* Use secure cookies in production.
* Configure Puppeteer correctly for PDF generation.

## Challenges Faced

* Handling resume upload using Multer
* Sending form data from frontend to backend
* Integrating AI response generation
* Maintaining a structured JSON response from AI
* Implementing JWT authentication
* Solving CORS and cookie issues in production
* Deploying frontend and backend separately
* Generating PDF using Puppeteer
* Creating a clean and responsive report UI

## Future Improvements

* Add Google authentication
* Add company-specific interview preparation
* Add difficulty level selection for questions
* Add complete interview report export
* Add user progress tracking for roadmap tasks
* Add dashboard analytics for preparation history

## Author

**Akhil Mittal**

* GitHub: [akhil5005](https://github.com/akhil5005)
* Email: [amittal2_be23@thapar.edu](mailto:amittal2_be23@thapar.edu)



