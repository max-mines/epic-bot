# Epic Bot - Future Improvements

## High Priority

### Features
- [x] **Interactive story refinement mode**: After initial stories are created, enable conversation mode around specific issues ✅
  - ✅ Allow user to select a specific story (e.g., "issue 1" or "story 2")
  - ✅ Enter focused discussion mode for that story
  - ✅ Refine the story, add/edit acceptance criteria collaboratively
  - ✅ Navigate between stories ("next", "prev", "back to menu")
  - ✅ Exit to overview or push all changes to GitHub when done
  - ✅ Print out the available options and navigation at the end of each output
- [x] **First-class Epic support in GitHub**: Use GitHub Milestones for Epics ✅
  - ✅ Epics are now created as GitHub Milestones
  - ✅ Story issues are assigned to their parent Milestone
  - ✅ Better integration with GitHub Projects and roadmaps
  - ✅ `/delete-epic` now closes milestone and all its issues

### Commands
- [ ] Add `/list-epics` command to show all epics for a user
- [ ] Add `/edit-epic` command to modify existing epics
- [ ] Add help command or improve inline help text

### Error Handling
- [ ] Add retry logic for Claude API failures
- [ ] Add error handling for GitHub API rate limits
- [ ] Improve parsing validation to ensure all stories have required fields

### Session Management
- [ ] Consider persisting sessions to handle bot restarts
- [ ] Add session timeout warnings before cleanup

## Medium Priority

### GitHub Integration
- [ ] Add option to assign issues to team members automatically
- [ ] Add epic description/context field for more detailed overview
- [ ] Add estimated story points or complexity indicators
- [ ] Support GitHub Projects integration for automatic epic/story tracking

### User Experience
- [ ] Add prettier formatting with Slack Block Kit for better visual presentation
- [ ] Add progress indicators during long-running operations
- [ ] Support editing specific stories without regenerating entire epic

### Analytics
- [ ] Track token usage and costs per epic
- [ ] Add usage statistics dashboard
- [ ] Track epic completion rates and velocity

## Low Priority

### Features
- [ ] Support exporting epics to other formats (Jira, Linear, etc.)
- [ ] Add templates for common epic types
- [ ] Support collaborative epic creation (multiple users in thread)
- [ ] Add AI-powered epic similarity detection to prevent duplicates

### Infrastructure
- [ ] Add comprehensive test suite
- [ ] Set up CI/CD pipeline
- [ ] Add deployment documentation for cloud hosting
- [ ] Consider moving to database for multi-workspace support

### Documentation
- [ ] Add video walkthrough
- [ ] Create troubleshooting guide with common errors
- [ ] Add examples of well-formed vs poorly-formed epics
- [ ] Document best practices for writing acceptance criteria

## Ideas for Future Consideration

- Integration with AI coding agents (auto-create PRs from stories)
- Support for sub-epics and epic hierarchies
- Automatic epic progress tracking based on linked PR status
- Slack notifications when stories are completed
- Epic versioning and changelog
- Support for multiple GitHub repositories
- Custom labels and workflows per team
- Integration with time tracking tools
