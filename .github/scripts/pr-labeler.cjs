module.exports = async ({ github, context }) => {
  const pull_number = context.payload.pull_request?.number;
  if (!pull_number) {
    console.log("No pull request number found in context. Skipping labeler.");
    return;
  }

  const { owner, repo } = context.repo;

  console.log(`Fetching files for PR #${pull_number}`);
  
  // Fetch list of files changed in the PR
  // For PRs with more than 100 files, we just use the first 100 for simplicity
  const { data: files } = await github.rest.pulls.listFiles({
    owner,
    repo,
    pull_number,
    per_page: 100
  });

  const labelsToAdd = new Set();

  files.forEach(file => {
    const filename = file.filename;
    
    // Rule: documentation
    if (filename.startsWith('docs/') || filename.endsWith('.md')) {
      labelsToAdd.add('documentation');
    }
    
    // Rule: frontend
    if (filename.startsWith('src/') || filename.startsWith('public/')) {
      labelsToAdd.add('frontend');
    }
    
    // Rule: ci/cd
    if (filename.startsWith('.github/workflows/')) {
      labelsToAdd.add('ci/cd');
    }
  });

  if (labelsToAdd.size > 0) {
    const labelsArray = Array.from(labelsToAdd);
    console.log(`Adding labels: ${labelsArray.join(', ')}`);
    
    await github.rest.issues.addLabels({
      owner,
      repo,
      issue_number: pull_number,
      labels: labelsArray
    });
  } else {
    console.log("No matching rules found for the changed files. No labels added.");
  }
};
