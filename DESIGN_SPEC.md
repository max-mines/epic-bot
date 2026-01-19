# Epic & User Story Bot - Design Specification

## Overview

A lightweight Slack bot that helps students write well-structured epics and user stories through a simple two-phase process. Phase 1 creates the epic interactively. Phase 2 reviews it with fresh context. Output goes directly to GitHub as issues.

**Scope:** Single workspace, 3 users, 12-week project, minimal infrastructure.

## System Architecture

```
User types: /story "Build student dashboard"
     ↓
Slack Bot (Node.js + Bolt SDK)
     ↓
Claude API (generates stories, reviews)
     ↓
Local JSON file (epic-{id}.json)
     ↓
GitHub API (creates issues)
```

**Tech Stack:**
- Node.js + @slack/bolt (Slack bot)
- @anthropic-ai/sdk (LLM)
- @octokit/rest (GitHub)
- Simple JSON files (no database)
- Runs locally or on a single server

---

## Phase 1: Epic Creation Session

### Purpose
Transform student ideas into well-structured epics with detailed user stories through guided conversation.

### 1.1 Slack Command Interface

```
/story <description>
```

**Examples:**
```
/story Build a student dashboard to track assignments
/story Add user authentication
```

Bot responds in a thread with questions.

### 1.2 Conversation Flow

#### Step 1: Initial Parsing & Understanding

**Example Response:**
```
📝 Creating epic: "Student Assignment Dashboard"

I'll ask you 3 quick questions to flesh this out.
```

#### Step 2: Three Questions

Bot asks 3 questions in sequence:

1. **Who's this for?** (e.g., "students", "instructors and students")
2. **What problem does it solve?** (freeform text)
3. **What's your tech stack?** (e.g., "React + Node + Postgres")

User replies to each in the thread.

#### Step 3: Generate Stories

Bot calls Claude to generate 4-6 user stories and posts them:

```
Generated 5 user stories:

1. View all assignments
   As a student, I want to see all my assignments in one place
   So that I can track what needs to be done

2. Filter by course
   As a student, I want to filter assignments by course
   So that I can focus on one class

[... 3 more stories ...]

Look good? [Y/n]
```

User types "Y" to approve or suggests changes.

#### Step 4: Optional Refinement

If user says anything other than "Y", bot asks:
```
What would you like to change?
```

User can say things like:
- "Add a story for error handling"
- "Story 3 is too big, split it"
- "Remove story 5"

Bot regenerates and asks again: "Look good? [Y/n]"

#### Step 5: Save Epic

Bot saves to `./epics/epic-{timestamp}.json`:

```json
{
  "id": "epic-20260119-1430",
  "title": "Student Assignment Dashboard",
  "created_by": "U12345",
  "created_at": "2026-01-19T14:30:00Z",
  "users": "students",
  "problem": "Assignments scattered across platforms",
  "tech_stack": "React, Node, Postgres",
  "stories": [
    {
      "id": "story-001",
      "title": "View all assignments",
      "story": "As a student I want to...",
      "acceptance_criteria": [
        "Display all assignments",
        "Show due dates"
      ]
    }
  ]
}
```

Bot responds:
```
✅ Epic saved! Running review...
```

### 1.3 State Management

Simple in-memory state (resets on bot restart):
```javascript
const sessions = new Map(); // key: thread_ts, value: { state, data }
```

No persistence needed - conversations are short.

---

## Phase 2: Design Review Session

### Purpose
Evaluate the epic with fresh context using standard design review principles to ensure scalability, maintainability, and architectural soundness.

### 2.1 Trigger Mechanism

After Phase 1 completes:
- Runs immediately (no delay)
- Start Phase 2 in same thread
- New Claude session (no conversation history from Phase 1)

### 2.2 Review Process

Bot loads the epic JSON (only) and sends it to Claude with a review prompt:

**Review checks:**
1. Are stories small enough? (3-5 acceptance criteria each)
2. Do stories have clear user value? ("So that..." clause)
3. Are there obvious missing stories? (error handling, edge cases)
4. Are acceptance criteria specific and testable?

That's it. Keep it simple.

### 2.3 Review Output

Bot posts simple feedback:

```
🔍 Review complete!

✅ Good:
- Stories are well-sized
- Clear user value in each story

⚠️ Issues:
- Story 3 missing error handling in acceptance criteria
- Consider adding a story for loading states

Approve and create GitHub issues? [Y/n]
```

If user says "Y", proceed to GitHub. Otherwise, go back to Phase 1 with the feedback.

### 2.4 Revision Loop

If user says "n":
- Bot asks: "What should I fix?"
- User provides feedback
- Bot regenerates stories
- Runs review again
- Max 2 iterations, then proceeds anyway

---

## Technical Implementation

### 3.1 Components

1. **Slack Bot** (`bot.js`)
   - Handles `/story` command
   - Manages thread conversations
   - Posts messages

2. **Claude Integration** (`claude.js`)
   - Calls Anthropic API
   - Story generation prompt
   - Review prompt

3. **GitHub Integration** (`github.js`)
   - Creates issues from stories
   - Adds labels

4. **File Storage** (`./epics/` directory)
   - Saves epic JSON files
   - No database needed

### 3.2 Tech Stack

```json
{
  "dependencies": {
    "@slack/bolt": "^3.x",
    "@anthropic-ai/sdk": "^0.x",
    "@octokit/rest": "^20.x",
    "dotenv": "^16.x"
  }
}
```

### 3.3 Data Model

```typescript
interface Epic {
  id: string;
  title: string;
  created_by: string;
  created_at: string;
  users: string;
  problem: string;
  tech_stack: string;
  stories: Story[];
}

interface Story {
  id: string;
  title: string;
  story: string;
  acceptance_criteria: string[];
}
```

That's it. Keep it minimal.

---

## Complete Flow Example

```
User: /story Build a student dashboard to track assignments

Bot: 📝 Creating epic: "Student dashboard to track assignments"
     I'll ask 3 quick questions.

     Q1: Who is this for?

User: Students

Bot: Q2: What problem does it solve?

User: Assignments scattered everywhere, students forget deadlines

Bot: Q3: Tech stack?

User: React, Node, Postgres

Bot: Generating stories...

     ✅ Generated 5 stories:

     1. View all assignments
        As a student I want to see all assignments
        So that I can track what's due
        - Display all assignments from all courses
        - Show due dates
        - Sort by date

     2. Filter by course
        As a student I want to filter by course
        So that I can focus on one class
        - Dropdown with all courses
        - Instant filter

     [...3 more stories...]

     Look good? [Y/n]

User: Y

Bot: ✅ Saved to epics/epic-20260119-1430.json
     Running review...

     🔍 Review complete!

     ✅ Good:
     - Stories are small and focused
     - Clear user value

     ⚠️ Suggestions:
     - Add error handling story
     - Story 1: Add loading state to acceptance criteria

     Create GitHub issues? [Y/n]

User: Y

Bot: ✅ Created 5 issues in your-org/your-repo:
     - #42: View all assignments
     - #43: Filter by course
     [...3 more...]

     Done! 🎉
```

---

## Learning Outcomes

Students learn:
1. How to break features into user stories
2. How to write good acceptance criteria
3. The value of design review (Phase 2 fresh eyes)
4. How epics translate to GitHub issues

---

## GitHub Integration

Each story becomes an issue:

```
Title: story-001: View all assignments

Body:
As a student I want to see all assignments
So that I can track what's due

Acceptance Criteria:
- [ ] Display all assignments
- [ ] Show due dates
- [ ] Sort by date

Part of epic: epic-20260119-1430

Labels: user-story, epic-bot
```

AI agents can then pick up these issues and write PRs.

---

## Success Metrics

For 3 students over 12 weeks:
- Each student creates 5-10 epics
- Average time < 10 minutes per epic
- Stories are actionable (AI agents can implement them)

---

## Security

- Slack tokens in `.env` (don't commit)
- Anthropic API key in `.env`
- GitHub personal access token in `.env`
- Data sent to Claude API (read Anthropic's terms)
- Epic files stored locally (not sensitive for class project)

---

## Future Ideas

If this works well:
- Add `/list-epics` command
- Support editing existing epics
- Prettier formatting in Slack
- Dashboard to see all epics
