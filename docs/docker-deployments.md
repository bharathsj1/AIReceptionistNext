# Docker deployments

Pull requests run `Backend Docker checks` on GitHub-hosted runners. Successful push checks on `main` request an exact-commit deployment through the local Vedora console. Main preserves the existing production mapping; staging preserves the development mapping.

The repository-scoped local runner only invokes its installed deployment client. It never checks out or executes pull-request code. The console independently verifies the completed workflow, repository, branch, SHA, and current branch head before queuing a deployment, then reports readiness. Deployment logs and history are at http://localhost:8095/.

Docker Desktop and this machine must be running. The runner has no Docker socket or GitHub PAT; it holds repository runner credentials and a local console token in restricted Docker volumes. Workflow files and the installed client are trusted deployment configuration. Application images are tagged with the commit. Existing configuration, secrets, database and media volumes remain at their installed locations.

Merging installs the workflow. Deployment requires BOTH repository variable LOCAL_DOCKER_DEPLOY_ENABLED=true and local registry status enabled. The activation helper verifies successful checks and skips deployment of installation commits before enabling future pushes. Failed checks, pull requests, forks, old branch heads and unmapped branches do not deploy. If the console is unavailable, the deployment job fails visibly. Use the console's previous deployment details to redeploy a known commit after investigating any failure.
