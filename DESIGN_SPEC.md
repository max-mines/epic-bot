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

The bot supports three revision pathways after the review, each with different iteration behaviors:

#### Option 1: Bulk Issue Resolution (Recommended)
After review completes, if issues are found:
```
Type `all` to address all issues, or `1, 2, 4` to address specific ones.
```

**Flow:**
1. User types `all` or specific issue numbers (e.g., `1, 3`)
2. Bot automatically addresses selected issues via Claude
3. Stories are regenerated with fixes applied
4. Returns to REVIEW_APPROVAL state with prompt: "Create GitHub issues? [Y/n/refine]"
5. User can approve (`Y`), select more issues to address, or use interactive mode

**Implementation Details:**
- Parses numbered issues from review output (1., 2., 3.)
- Stores issues in `session.reviewIssues` array with `{ number, text }` structure
- Builds targeted feedback string from selected issues
- Calls `refineStories()` with feedback: "Address the following issues from the review:\n- [issue text]\n- [issue text]"
- **No iteration limit** - user can address issues indefinitely
- Epic JSON file is updated after each refinement

#### Option 2: Interactive Refinement Mode
User types `refine` to enter story-by-story editing:

**Flow:**
1. Shows numbered story menu with navigation options
2. User selects story by number (e.g., `3`)
3. Bot displays full story with acceptance criteria
4. User describes changes in natural language
5. Bot refines single story via `refineSingleStory()`
6. User can navigate (`next`, `prev`, `back`) or continue editing
7. On `done`, behavior depends on context:
   - New epics: Creates GitHub issues
   - Existing epics with GitHub numbers: Updates issues
   - Existing epics without GitHub: Saves and offers to publish

**States:**
- `INTERACTIVE_MODE`: Story selection menu
- `STORY_FOCUSED`: Editing a specific story

**Navigation Commands:**
- `next` / `prev` - Move between stories
- `back` - Return to story menu
- `overview` - Show all stories
- `done` - Exit interactive mode

**No iteration limit** - user can refine stories indefinitely

#### Option 3: Freeform Refinement (Legacy Path)
User types anything other than `Y`, `review`, `refine`, `all`, or issue numbers after APPROVAL state:

**Flow:**
1. Bot asks: "What would you like to change?"
2. User provides freeform feedback text
3. Bot enters REFINING state
4. Calls `refineStories()` with user's text as feedback
5. Stories regenerated
6. Returns to APPROVAL state (bypasses review)
7. Shows: "✅ Updated stories:\n\n[stories]\n\nLook good? [Y/n]"

**Iteration Limit:**
```javascript
session.refinementCount = (session.refinementCount || 0) + 1;
if (session.refinementCount >= 2) {
  // Force proceed to GitHub creation
  await handleMessage(session, 'Y', threadTs, client);
}
```
- Max 2 iterations enforced
- After 2nd iteration, auto-proceeds with "Maximum refinements reached"
- Counter only applies to freeform refinement, not bulk issue resolution

#### State Flow Diagram
```
APPROVAL → review → REVIEWING → REVIEW_APPROVAL
   ↓                                   ↓
  Y/n                          all/1,2,3/refine/Y/n
   ↓                                   ↓
GitHub                    ┌─────────────┼─────────────┐
                         ↓             ↓             ↓
                    REFINING     INTERACTIVE    GitHub
                    (bulk)          MODE
                       ↓               ↓
                 REVIEW_APPROVAL   STORY_FOCUSED
```

#### Key Design Decision: No Review Re-run
After bulk issue resolution, the bot does NOT automatically re-run the review. This design choice:
- Avoids infinite review loops
- Trusts Claude's ability to address specified issues
- User can manually re-review by using `/review-epic` command on saved epic
- Reduces API calls and latency

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
