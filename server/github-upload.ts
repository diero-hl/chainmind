// GitHub integration for uploading docs
import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from 'path';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

export async function uploadDocsToGithub(repoName: string) {
  const octokit = await getUncachableGitHubClient();
  
  // Get authenticated user
  const { data: user } = await octokit.users.getAuthenticated();
  const owner = user.login;
  
  console.log(`Uploading to ${owner}/${repoName}...`);
  
  // Check if repo exists, if not create it
  try {
    await octokit.repos.get({ owner, repo: repoName });
    console.log('Repository exists');
  } catch (e: any) {
    if (e.status === 404) {
      console.log('Creating repository...');
      await octokit.repos.createForAuthenticatedUser({
        name: repoName,
        description: 'ChainMind Documentation - AI-powered token launcher on Base',
        auto_init: true,
      });
      // Wait a bit for repo to be ready
      await new Promise(r => setTimeout(r, 2000));
    } else {
      throw e;
    }
  }
  
  // Read all docs files
  const docsDir = path.join(process.cwd(), 'docs');
  const files = fs.readdirSync(docsDir);
  
  const uploadedFiles: string[] = [];
  
  for (const file of files) {
    if (!file.endsWith('.md')) continue;
    
    const filePath = path.join(docsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const contentBase64 = Buffer.from(content).toString('base64');
    
    // Check if file exists to get its SHA
    let sha: string | undefined;
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo: repoName,
        path: file,
      });
      if (!Array.isArray(data) && 'sha' in data) {
        sha = data.sha;
      }
    } catch (e: any) {
      // File doesn't exist yet, that's fine
    }
    
    // Upload file
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo: repoName,
      path: file,
      message: `Update ${file}`,
      content: contentBase64,
      sha,
    });
    
    uploadedFiles.push(file);
    console.log(`Uploaded: ${file}`);
  }
  
  return {
    success: true,
    repo: `https://github.com/${owner}/${repoName}`,
    files: uploadedFiles,
  };
}

export async function getGitHubUser() {
  const octokit = await getUncachableGitHubClient();
  const { data: user } = await octokit.users.getAuthenticated();
  return user;
}
