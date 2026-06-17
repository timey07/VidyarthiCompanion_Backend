<![CDATA[<div align="center">

# ⚙️ VidyarthiCompanion — Backend

### Express 5 REST API powering the Campus OS

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Mongoose_9-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Gemini AI](https://img.shields.io/badge/Gemini_AI-2.5_Flash-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![Amazon Bedrock](https://img.shields.io/badge/Amazon_Bedrock-Ready-FF9900?logo=amazon-aws&logoColor=white)](https://aws.amazon.com/bedrock/)

</div>

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [API Reference](#-api-reference)
- [Modules (Engines)](#-modules-engines)
- [Shared Models](#-shared-models)
- [Core Services](#-core-services)
- [Seeding Data](#-seeding-data)
- [Scripts](#-scripts)

---

## 📖 Overview

The VidyarthiCompanion backend is a modular **Express 5 REST API** built on a **sensor → engine** architecture. Each feature is an isolated engine module with its own routes, controllers, services, and Mongoose models. The API powers all AI-driven features via **Google Gemini 2.5 Flash** (with Amazon Bedrock as a pluggable alternative) and persists data in **MongoDB** via Mongoose 9.

All feature routes (except auth) are protected by **JWT-based authentication**.

---

## 🛠 Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| **Express** | 5.2.1 | REST API framework with modern async error handling |
| **Mongoose** | 9.7.0 | MongoDB ODM with schema validation |
| **Gemini AI** | 0.24.1 | Vision OCR, intent extraction, RAG-based Q&A |
| **AWS Bedrock SDK** | 3.x | Amazon Bedrock integration (pluggable AI provider) |
| **bcryptjs** | 3.x | Password hashing for user authentication |
| **jsonwebtoken** | 9.x | JWT token generation & verification |
| **node-schedule** | 2.x | Cron-like scheduling for departure alarms & nightly rebuilds |
| **sharp** | 0.35.x | Image processing for uploaded notice/receipt images |
| **cors** | 2.x | Cross-origin request handling |
| **dotenv** | 17.x | Environment variable management |
| **nodemon** | 3.x | Development hot-reload |

---

## 📁 Project Structure

```
VidyarthiCompanion-backend/
├── src/
│   ├── server.js                    # App entry — Express setup, route mounting, bootstrap
│   ├── core/                        # Shared infrastructure & middleware
│   │   ├── db.js                    # MongoDB connection via Mongoose
│   │   ├── authMiddleware.js        # JWT `protect` middleware (populates req.user)
│   │   ├── alertScheduler.js        # node-schedule alarm manager for event alerts
│   │   ├── gemini.service.js        # Google Gemini AI client & prompt utilities
│   │   ├── bedrockClient.js         # Amazon Bedrock client (pluggable alternative)
│   │   └── middleware.js            # Shared Express middleware
│   ├── modules/                     # Feature engine modules (each self-contained)
│   │   ├── authEngine/              # User registration, login, JWT auth
│   │   ├── communityEngine/         # Community nodes, join codes, alerts
│   │   ├── empathyMesh/             # Safe-Skip burnout calculus, empathy nudges
│   │   ├── overrideEngine/          # AI image extraction + consensus voting
│   │   ├── pocketBuddy/             # Wallet transactions, budget recommendations
│   │   ├── presenceEngine/          # Geo-presence tracking, campus check-in
│   │   ├── profileEngine/           # User profile CRUD, attendance buffer
│   │   ├── recommendationEngine/    # AI-driven personalized recommendations
│   │   ├── retrievalEngine/         # Ground-truth retrieval & RAG Q&A
│   │   ├── routineEngine/           # Dynamic Baseline Routine management
│   │   ├── transitEngine/           # Haversine departure ETA & "Leave Now" alerts
│   │   └── wellnessEngine/          # Lifestyle logs, burnout scoring, wellness state
│   ├── sharedModels/                # Mongoose models shared across engines
│   │   ├── User.model.js            # User schema (profile, auth, preferences)
│   │   ├── AcademicEvent.model.js   # Academic events (classes, exams, deadlines)
│   │   ├── AttendanceRecord.model.js # Per-class attendance tracking
│   │   ├── BaselineRoutine.model.js # Dynamic daily routine template
│   │   ├── CampusMerchant.model.js  # Campus vendors & merchant graph
│   │   ├── CommunityAlert.model.js  # Community-wide alerts & announcements
│   │   ├── CommunityNode.model.js   # Community graph nodes (class, mess, gym, club)
│   │   ├── ConsensusVote.model.js   # Echo/Flag votes for event verification
│   │   ├── LifestyleLog.model.js    # Sleep, mood, activity passive telemetry
│   │   ├── Meetup.model.js          # Community meetups & events
│   │   ├── MessMealVote.model.js    # Crowdsourced mess meal quality votes
│   │   ├── MessMenu.model.js        # Hostel mess menu data
│   │   └── Transaction.model.js     # PocketBuddy financial transactions
│   ├── seedDemoData.js              # Seed script — populates demo events & communities
│   └── seedUsers.js                 # Seed script — creates demo user accounts
├── .env                             # Environment variables (not committed)
├── .gitignore                       # Git ignore rules
├── activate-model.js                # Utility to activate/test Bedrock model access
├── test-bedrock.js                  # Bedrock integration smoke test
├── package.json                     # Dependencies & scripts
└── README.md                        # ← You are here
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **MongoDB** — either a local instance (`mongod`) or [MongoDB Atlas](https://www.mongodb.com/atlas) cloud
- **Gemini API Key** — [Get one from Google AI Studio](https://ai.google.dev/)
- *(Optional)* AWS credentials for Amazon Bedrock

### Installation

```bash
# Navigate to the backend directory
cd VidyarthiCompanion-backend

# Install dependencies
npm install

# Create your environment file
cp .env.example .env
# Edit .env with your MONGO_URI, GEMINI_API_KEY, etc.

# Start the development server (with hot-reload via nodemon)
npm run dev
```

The API will be running at **http://localhost:5000**.

### Verify It's Running

```bash
curl http://localhost:5000/
# → { "status": "CampusOS API is running normally." }
```

---

## 🔐 Environment Variables

Create a `.env` file in the project root:

```env
MONGO_URI=mongodb://127.0.0.1:27017/campusos
PORT=5000
GEMINI_API_KEY=your_gemini_api_key_here
```

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URI` | ✅ | MongoDB connection string (local or Atlas) |
| `PORT` | ❌ | Server port (defaults to `5000`) |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key for AI/OCR features |

> **⚠️ Security Note:** Never commit your `.env` file. The `.gitignore` is pre-configured to exclude it.

---

## 📡 API Reference

Base URL: `http://localhost:5000/api/v1`

All routes except `/auth/register` and `/auth/login` require a valid JWT token in the `Authorization: Bearer <token>` header.

### Authentication

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/auth/register` | Register a new user | ❌ |
| `POST` | `/auth/login` | Login and receive JWT token | ❌ |
| `GET` | `/auth/me` | Get current authenticated user | ✅ |

### Feature Engines

| Method | Base Endpoint | Module | Description |
|--------|---------------|--------|-------------|
| `*` | `/overrides` | Override Engine | AI image extraction, event creation, consensus voting |
| `*` | `/pocket` | PocketBuddy | Transaction CRUD, budget analysis, recommendations |
| `*` | `/empathy` | Empathy Mesh | Safe-Skip eligibility, empathy circle management |
| `*` | `/wellness` | Wellness Engine | Lifestyle log submission, burnout score calculation |
| `*` | `/community` | Community Engine | Node CRUD, join-by-code, alerts, mess ticker |
| `*` | `/retrieval` | Retrieval Engine | RAG-based Q&A, ground-truth document queries |
| `*` | `/transit` | Transit Engine | Departure ETA, "Leave Now" alarm management |
| `*` | `/presence` | Presence Engine | Geo-location tracking, campus check-in |
| `*` | `/routine` | Routine Engine | Baseline routine CRUD, recalculation triggers |
| `*` | `/profile` | Profile Engine | User profile CRUD, attendance buffer updates |

> Each module registers its own sub-routes. Refer to the individual `*.routes.js` files for detailed endpoint documentation.

---

## 🧩 Modules (Engines)

Each module under `src/modules/` is a self-contained feature engine following this pattern:

```
moduleName/
├── module.routes.js       # Express router — endpoint definitions
├── module.controller.js   # Request handlers — parse input, call services, send response
├── module.service.js       # Business logic — data processing, AI calls, calculations
└── module.model.js        # (optional) Module-specific Mongoose model
```

### Module Descriptions

| Module | Description |
|--------|-------------|
| **authEngine** | User registration with bcrypt password hashing, JWT-based login, token verification, and `GET /me` for session validation. |
| **overrideEngine** | Accepts uploaded images (notice boards, WhatsApp screenshots), sends them to Gemini Vision for intent/event extraction with confidence scores, creates pending events, and routes them through community consensus voting. |
| **pocketBuddy** | Records financial transactions (via image OCR or manual text), categorizes spending, tracks against monthly budget, and generates AI-powered budget recommendations via the campus merchant graph. |
| **empathyMesh** | Calculates Safe-Skip eligibility by correlating burnout scores with attendance buffer. When triggered, sends anonymous empathy nudges to the student's designated circle for note-sharing. |
| **wellnessEngine** | Ingests passive lifestyle logs (sleep hours, mood, activity level), computes weighted burnout scores, and exposes wellness state for the Empathy Mesh and Routine Engine. |
| **communityEngine** | Manages the multi-tiered community graph — create/join nodes (classmates, mess, gym, club) via invite codes, post alerts, run consensus votes, and crowdsource mess meal quality. |
| **retrievalEngine** | Ground-truth retrieval using Gemini's RAG capabilities for factual Q&A against verified campus data (syllabi, schedules, policies). |
| **transitEngine** | Calculates Haversine-based departure ETAs per transport mode (walk/cycle/auto), schedules "Leave Now" alarms via node-schedule, and suppresses alerts when the student is already on-site. |
| **presenceEngine** | Tracks student geo-presence on campus for location-aware features (transit ETA, nearby community events). |
| **routineEngine** | Manages the Dynamic Baseline Routine — a continuous state machine that recalculates study blocks, sleep windows, and budget limits when upstream events change. |
| **profileEngine** | User profile management including academic details, attendance buffer configuration, empathy circle setup, and notification preferences. |
| **recommendationEngine** | AI-driven personalized recommendations for meals, study spots, and activities based on context (time, budget, wellness state, location). |

---

## 📦 Shared Models

All Mongoose models in `src/sharedModels/` are shared across multiple engines:

| Model | Description |
|-------|-------------|
| `User` | Core user schema — auth credentials, profile, preferences, trust score, community memberships |
| `AcademicEvent` | Academic events — classes, exams, deadlines with verification status and AI confidence |
| `AttendanceRecord` | Per-class attendance tracking with percentage calculation |
| `BaselineRoutine` | Dynamic daily routine template with time-block slots |
| `CampusMerchant` | Campus vendors — crowdsourced categorization for the merchant graph |
| `CommunityNode` | Community graph nodes with type (class/mess/gym/club), members, and invite codes |
| `CommunityAlert` | Community-scoped alerts and announcements |
| `ConsensusVote` | Echo(+1)/Flag(−1) votes for event verification (unique per `{eventId, userId}`) |
| `LifestyleLog` | Passive telemetry — sleep, mood, activity for burnout calculation |
| `Meetup` | Community meetups with location, time, and RSVP tracking |
| `MessMealVote` | Crowdsourced meal quality ratings for the mess ticker |
| `MessMenu` | Hostel mess menu data (weekly rotation) |
| `Transaction` | PocketBuddy financial transactions with source enum (Amazon Pay-ready) |

---

## 🔧 Core Services

| Service | File | Description |
|---------|------|-------------|
| **Database** | `core/db.js` | MongoDB connection via Mongoose with auto-reconnect |
| **Auth Middleware** | `core/authMiddleware.js` | JWT `protect` middleware — verifies token, populates `req.user` |
| **Gemini AI** | `core/gemini.service.js` | Google Gemini 2.5 Flash client — OCR, intent extraction, RAG prompts |
| **Bedrock Client** | `core/bedrockClient.js` | Amazon Bedrock client — pluggable AI alternative for AWS deployment |
| **Alert Scheduler** | `core/alertScheduler.js` | node-schedule manager for "Leave Now" departure alarms & nightly routine rebuilds |
| **Middleware** | `core/middleware.js` | Shared Express middleware (error handling, logging) |

### Bootstrap Flow

On startup, `server.js` performs:

1. **Initialize Express** — CORS, JSON body parser (10MB limit), URL encoding
2. **Mount Routes** — Auth (public) + all feature engines (JWT-protected)
3. **Connect MongoDB** — via `core/db.js`
4. **Bootstrap Alarms** — Queries all future `AcademicEvent` documents and re-arms departure alerts via `alertScheduler`

---

## 🌱 Seeding Data

Two seed scripts are provided for development and demo purposes:

```bash
# Create demo user accounts
node src/seedUsers.js

# Populate sample events, communities, transactions, etc.
node src/seedDemoData.js
```

> **Note:** Seeds connect to the `MONGO_URI` specified in your `.env` file.

---

## 📜 Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start server with nodemon (hot-reload on file changes) |
| `npm start` | Start server in production mode (`node src/server.js`) |
| `npm test` | *(placeholder)* — Run tests |

---

## 🧪 Testing Bedrock Integration

Two utility scripts are included for validating AWS Bedrock connectivity:

```bash
# Activate and verify Bedrock model access
node activate-model.js

# Run a smoke test against Bedrock
node test-bedrock.js
```

---

<div align="center">

**Part of the [VidyarthiCompanion](../README.md) Campus OS**

*Built by Team QuantYap for HackOn with Amazon 2026*

</div>
]]>
