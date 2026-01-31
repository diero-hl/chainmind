import { Octokit } from '@octokit/rest';
import * as fs from 'fs';
import * as path from 'path';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings?.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found');
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

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

async function getAllFiles(dir: string, baseDir: string = dir): Promise<{path: string, content: string}[]> {
  const files: {path: string, content: string}[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  const ignoreDirs = ['node_modules', '.git', 'dist', '.vercel', '.next', '.cache', 'coverage', '.config', '.upm', 'attached_assets'];
  const ignoreFiles = ['.env', '.env.local', '.env.production', 'package-lock.json', '.replit', 'replit.nix'];
  const ignoreExts = ['.log', '.lock', '.map'];
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(baseDir, fullPath);
    
    if (entry.isDirectory()) {
      if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
        files.push(...await getAllFiles(fullPath, baseDir));
      }
    } else {
      const ext = path.extname(entry.name);
      if (!ignoreFiles.includes(entry.name) && !entry.name.startsWith('.env') && !ignoreExts.includes(ext)) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.size < 100000) { // Skip files > 100KB
            const content = fs.readFileSync(fullPath, 'utf-8');
            if (!content.includes('\0')) { // Skip binary
              files.push({ path: relativePath, content });
            }
          }
        } catch (e) {
          // Skip
        }
      }
    }
  }
  return files;
}

async function main() {
  const REPO_NAME = 'chainmind';
  const accessToken = await getAccessToken();
  const octokit = new Octokit({ auth: accessToken });
  
  const { data: user } = await octokit.users.getAuthenticated();
  console.log('Authenticated as:', user.login);
  
  // Check if repo exists, if not create
  let repoExists = false;
  try {
    await octokit.repos.get({ owner: user.login, repo: REPO_NAME });
    repoExists = true;
    console.log('Repo exists:', REPO_NAME);
  } catch (e: any) {
    if (e.status === 404) {
      console.log('Creating repo...');
      await octokit.repos.createForAuthenticatedUser({
        name: REPO_NAME,
        description: 'ChainMind - AI-Powered Token Launcher on Base blockchain using Clanker',
        private: false,
        auto_init: true
      });
      console.log('Created repo:', REPO_NAME);
      // Wait for repo init
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  // Get all files
  console.log('Reading project files...');
  const projectDir = '/home/runner/workspace';
  const files = await getAllFiles(projectDir);
  console.log(`Found ${files.length} files to push`);
  
  // Get default branch ref
  const { data: ref } = await octokit.git.getRef({
    owner: user.login,
    repo: REPO_NAME,
    ref: 'heads/main'
  });
  const latestCommitSha = ref.object.sha;
  
  // Get the tree of the latest commit
  const { data: latestCommit } = await octokit.git.getCommit({
    owner: user.login,
    repo: REPO_NAME,
    commit_sha: latestCommitSha
  });
  
  // Create blobs in parallel batches
  console.log('Creating blobs in batches...');
  const treeItems: any[] = [];
  const BATCH_SIZE = 10;
  
  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (file) => {
        try {
          const { data: blob } = await octokit.git.createBlob({
            owner: user.login,
            repo: REPO_NAME,
            content: Buffer.from(file.content).toString('base64'),
            encoding: 'base64'
          });
          return {
            path: file.path,
            mode: '100644' as const,
            type: 'blob' as const,
            sha: blob.sha
          };
        } catch (e) {
          console.log('Failed:', file.path);
          return null;
        }
      })
    );
    treeItems.push(...results.filter(Boolean));
    process.stdout.write(`\r${treeItems.length}/${files.length} files...`);
  }
  
  console.log(`\nCreated ${treeItems.length} blobs`);
  
  // Create tree
  const { data: tree } = await octokit.git.createTree({
    owner: user.login,
    repo: REPO_NAME,
    base_tree: latestCommit.tree.sha,
    tree: treeItems
  });
  
  // Create commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner: user.login,
    repo: REPO_NAME,
    message: 'ChainMind - AI Token Launcher with Clanker, Kyberswap, and multi-DEX support',
    tree: tree.sha,
    parents: [latestCommitSha]
  });
  
  // Update ref
  await octokit.git.updateRef({
    owner: user.login,
    repo: REPO_NAME,
    ref: 'heads/main',
    sha: newCommit.sha
  });
  
  console.log('\n✅ Successfully pushed to GitHub!');
  console.log(`📁 Repository: https://github.com/${user.login}/${REPO_NAME}`);
}

main().catch(console.error);
