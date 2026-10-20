# Bootstrapping a deployment

The accounts and settings spotimy needs before its first deploy. They are made once, by hand, in this order. The repo refers to each by the name given here, and holds no values. To run the checks on a laptop, see [setup.md](setup.md).

## 1. AWS

1. Make an AWS account that holds spotimy and nothing else. Work in `us-east-1`: CloudWatch's billing metric exists only there.
2. Under Billing preferences, switch on billing alerts, or the spend alarm never fires.
3. In Parameter Store, Standard tier, in `us-east-1`, make three parameters:
   - `/spotimy/alerts/email`, a String: the address alerts go to.
   - `/spotimy/alerts/monthly-spend`, a String: the monthly bill in US dollars that sets off the spend alarm, such as `5`.
   - `/spotimy/session-key`, a SecureString: the key that signs sessions. Make it with `openssl rand -base64 48`.

## 2. Spotify

1. Sign in at https://developer.spotify.com/dashboard with the account that will own the app. It needs Spotify Premium: an app in development mode stops working when its owner's Premium lapses.
2. Create an app called spotimy. Tick Web API. Spotify asks for a redirect URI now, so give it `http://127.0.0.1:8888/callback` for the moment. Step 5 replaces it.
3. Under User Management, add each person who will use spotimy, by the name and email address of their Spotify account. Five at most, the owner included.
4. Copy the app's Client ID. It is not a secret.

## 3. GitHub

1. Make the repo `t-d-d/spotimy` and push this code to main. Its first deploy run fails, since nothing below exists yet.
2. Read its numeric ids: `gh api repos/t-d-d/spotimy --jq '.owner.id, .id'`.
3. Apply [infra/github-oidc.cfn.yml](../infra/github-oidc.cfn.yml) once by hand, as the stack `spotimy` in `us-east-1`, with the capability `CAPABILITY_NAMED_IAM`, and the parameters `GitHubOwnerId` and `GitHubRepoId` set to those ids. It makes GitHub's OIDC provider and the role `spotimy-github-deploy`, which only a job on main can assume. Each deploy applies it again after that.

   ```
   aws cloudformation deploy --region us-east-1 --stack-name spotimy \
     --template-file infra/github-oidc.cfn.yml --capabilities CAPABILITY_NAMED_IAM \
     --parameter-overrides GitHubOwnerId=<owner id> GitHubRepoId=<repo id>
   ```

4. Set the repo variables `AWS_DEPLOY_ROLE_ARN` (the stack's output), `AWS_REGION` (`us-east-1`) and `SPOTIFY_CLIENT_ID`, and the repo secret `SERVERLESS_ACCESS_KEY`, from the Serverless Framework dashboard.
5. Give main a ruleset that requires a pull request and the `gate` check.

## 4. The first deploy

In the Actions tab, re-run the failed deploy run on main. The run's summary gives the page's address and the redirect URI to use.

## 5. Finishing

1. In the Spotify app's settings, replace the redirect URI with the one the deploy gave: the page's address followed by `/api/callback`.
2. Confirm the alert email. The first deploy makes the alert topic, and AWS emails a link from `no-reply@sns.amazonaws.com`. No alarm reaches anyone until it is clicked, and it lasts three days.
3. Open the page and sign in. Then each other person signs in. Nothing changes in anyone's library until they press Apply plan.

To check that an alarm reaches you, run this in CloudShell in `us-east-1`:

```
aws cloudwatch set-alarm-state --alarm-name spotimy-error-lines \
  --state-value ALARM --state-reason "Checking the alert email arrives"
```
