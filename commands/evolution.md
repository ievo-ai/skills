---
description: Capture a lesson and integrate it into a local agent or skill. Pass the lesson text as the argument.
allowed-tools: Task
argument-hint: <lesson text>
---

# Evolution

Dispatch the `evolution` agent with the user's lesson.

The user's input (the text following `/ievo:evolution`) is the lesson to apply. Pass it verbatim to the evolution agent:

Use the Task tool with `subagent_type: "evolution"` and the following prompt:

```
Apply this lesson to the appropriate agent or skill:

<<<
$ARGUMENTS
>>>

Decide the target, copy from plugin source to project if necessary, patch the file, and append an entry to the evolution log. Report what you did and which section title was added to the log.
```

If the user provides no argument, ask them: "What lesson should I capture? Describe the rule, pattern, or behavior in plain language."
