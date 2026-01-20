# Quick Testing Mode - Feature Summary

## Overview
Added answer caching to speed up testing and iteration by allowing users to reuse their previous answers to the 3 setup questions.

## Implementation Date
2026-01-19

## How It Works

### Answer Cache
- In-memory cache (`answerCache`) stores previous answers per user ID
- Persists for the lifetime of the bot process
- Automatically populated after each epic creation

### User Experience

**First Use:**
```
Bot: Q1: Who is this for? (e.g., "students", "instructors and students")
You: students

Bot: Q2: What problem does it solve?
You: need a centralized place to view assignments

Bot: Q3: Tech stack? (e.g., "React, Node, Postgres")
You: React, Node, Postgres
```

**Subsequent Uses:**
```
Bot: Q1: Who is this for?
     Previous answer: "students"
     Type `same` to reuse, or provide a new answer.
You: same

Bot: Q2: What problem does it solve?
     Previous answer: "need a centralized place to view assignments"
     Type `same` to reuse, or provide a new answer.
You: same

Bot: Q3: Tech stack?
     Previous answer: "React, Node, Postgres"
     Type `same` to reuse, or provide a new answer.
You: same
```

**Mixed Mode:**
```
Bot: Q1: Who is this for?
     Previous answer: "students"
     Type `same` to reuse, or provide a new answer.
You: instructors  # Override with new answer

Bot: Q2: What problem does it solve?
     Previous answer: "need a centralized place to view assignments"
     Type `same` to reuse, or provide a new answer.
You: same  # Reuse previous

Bot: Q3: Tech stack?
     Previous answer: "React, Node, Postgres"
     Type `same` to reuse, or provide a new answer.
You: same  # Reuse previous
```

## Implementation Details

### Files Modified

**1. [bot.js](bot.js:19)** - Added answer cache
```javascript
// Cache for previous answers (per user)
const answerCache = new Map();
```

**2. [bot.js](bot.js:54-70)** - Initial question with cache check
```javascript
// Check if user has cached answers
const cached = answerCache.get(command.user_id);

// Ask first question
if (cached && cached.users) {
  await client.chat.postMessage({
    channel: command.channel_id,
    thread_ts: result.ts,
    text: `Q1: Who is this for?\n\nPrevious answer: "${cached.users}"\n\nType \`same\` to reuse, or provide a new answer.`
  });
} else {
  await client.chat.postMessage({
    channel: command.channel_id,
    thread_ts: result.ts,
    text: 'Q1: Who is this for? (e.g., "students", "instructors and students")'
  });
}
```

**3. [bot.js](bot.js:350-417)** - Question handlers with cache logic
- Each question state (Q1, Q2, Q3) checks for cached answers
- Handles "same" keyword to reuse cached values
- After Q3, saves all answers to cache

**4. [README.md](README.md:171-190)** - Documentation

### Key Features

✅ **Per-User Caching** - Each user has their own cached answers
✅ **Partial Reuse** - Can mix `same` and new answers
✅ **Non-Intrusive** - First-time users see normal flow
✅ **Clear UX** - Shows previous answer for context
✅ **Testing-Friendly** - Dramatically speeds up iteration

### Use Cases

1. **Testing Epic Descriptions**
   - Keep answers same, try different epic titles
   - Quick iteration on story generation quality

2. **Building Related Epics**
   - Same users, problem domain, tech stack
   - Different epic focuses

3. **Development/Debugging**
   - Skip repetitive typing during development
   - Focus on testing new features

### Technical Notes

- Cache is in-memory only (cleared on bot restart)
- No persistence to disk/database
- Cache key is Slack user ID
- No size limit (grows with unique users)
- No expiration (lifetime of bot process)

### Future Enhancements

Potential improvements:
- [ ] Add `/clear-cache` command to reset answers
- [ ] Persist cache to file/database for bot restarts
- [ ] Add cache expiration (e.g., 24 hours)
- [ ] Show all cached values with `/show-cache`
- [ ] Allow setting defaults per workspace

## Example Session

```
User: /story Build assignment grading system

Bot: 📝 Creating epic: "Build assignment grading system"

     I'll ask 3 quick questions.

Bot: Q1: Who is this for?
     Previous answer: "students"
     Type `same` to reuse, or provide a new answer.

User: instructors

Bot: Q2: What problem does it solve?
     Previous answer: "need a centralized place to view assignments"
     Type `same` to reuse, or provide a new answer.

User: need to grade assignments efficiently

Bot: Q3: Tech stack?
     Previous answer: "React, Node, Postgres"
     Type `same` to reuse, or provide a new answer.

User: same

Bot: Generating stories...

Bot: ✅ Generated 5 stories:
     [stories listed...]
```

In this example:
- Q1: User provided new answer ("instructors")
- Q2: User provided new answer ("need to grade assignments efficiently")
- Q3: User reused previous answer ("React, Node, Postgres")

All three answers are now cached for the next epic creation.
