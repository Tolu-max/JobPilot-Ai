# Glassdoor role import

JobPilot does not crawl Glassdoor. The Glassdoor source reads a local role list at `profiles/<profile>/glassdoor-import.json` and sends each valid role through normal profile matching and application gates.

To use it, add role details that you have collected through your own Glassdoor workflow. `applicationUrl` must be the employer's direct application page on an audited ATS supported by JobPilot. A Glassdoor job page alone is not enough for automatic application. Unknown ATS destinations are skipped by the importer.

```json
{
  "jobs": [
    {
      "title": "Frontend Developer",
      "company": "Example employer",
      "location": "Remote, worldwide",
      "description": "Build customer-facing web applications with JavaScript and React.",
      "requirements": "JavaScript, React, HTML, CSS",
      "postedAt": "2026-09-25T00:00:00.000Z",
      "glassdoorUrl": "https://www.glassdoor.com/job-listing/example",
      "applicationUrl": "https://boards.greenhouse.io/example/jobs/123456"
    }
  ]
}
```

The file is profile-local and should not be committed. Imported roles still pass freshness, location, duplicate, technical-fit, profile-approval, and ATS checks before any live submission.
