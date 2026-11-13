# Contributing to KDM-CLI

First off, thank you for considering contributing to KDM-CLI! It's people like you that make KDM-CLI such a great tool.

## Code of Conduct

By participating in this project, you are expected to uphold our Code of Conduct. Please report unacceptable behavior to the project maintainers.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the [issue tracker](https://github.com/KDM-cli/kdm-cli/issues) to see if the problem has already been reported. If it hasn't, please open a new issue.

When reporting a bug, please include:
- Your operating system and version.
- The version of Node.js you are using.
- The version of KDM-CLI you are using.
- Detailed steps to reproduce the bug.
- Any relevant logs or error messages.

### Suggesting Enhancements

If you have an idea to improve KDM-CLI, please open an issue in the [issue tracker](https://github.com/KDM-cli/kdm-cli/issues) and label it as an enhancement (or feature request). Include as much detail as possible about your idea and why it would be beneficial.

### Pull Requests

1. Fork the repo and create your branch from `main`.
2. Ensure you have Node.js installed.
3. Run `npm install` to install dependencies.
4. If you've added code that should be tested, add tests.
5. Ensure the test suite passes by running `npm run test`.
6. Ensure your code builds successfully with `npm run build`.
7. Issue that pull request!

## Development Setup

To set up your development environment:

1. Clone the repository:
   ```bash
   git clone https://github.com/KDM-cli/kdm-cli.git
   cd kdm-cli
   ```
2. Install the dependencies:
   ```bash
   npm install
   ```
   *(This automatically initializes Husky Git hooks to ensure code quality standards on commit and push)*
3. To start the development watcher:
   ```bash
   npm run dev
   ```
4. To run tests:
   ```bash
   npm run test
   ```

## Contributors

This project follows the [All Contributors](https://github.com/all-contributors/all-contributors) specification. Contributions of any kind are welcome!

### Adding Yourself as a Contributor

We use the [All Contributors Bot](https://allcontributors.org/docs/en/bot/overview) to automate adding contributors. You can add yourself by leaving a comment on your Pull Request or any Issue:

```
@all-contributors please add @<username> for <contribution-type>
```

For example, to add yourself for code contribution:
```
@all-contributors please add @your-username for code
```

For a list of valid contribution types, see the [Emoji Key](https://allcontributors.org/docs/en/emoji-key).

## Coding Style

Please ensure your code is idiomatic and follows the existing TypeScript conventions in the codebase.
