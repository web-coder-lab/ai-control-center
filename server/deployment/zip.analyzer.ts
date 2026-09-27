import JSZip from 'jszip';

export interface ZipAnalysisResult {
  projectType: 'node_express' | 'react_vite' | 'nextjs' | 'static' | 'docker' | 'unknown';
  framework: string;
  name: string;
  detectedBuildCommand: string;
  detectedStartCommand: string;
  envVarNames: string[];
  hasDockerfile: boolean;
  hasRenderYaml: boolean;
  totalFiles: number;
  totalSize: number;
  warnings: string[];
}

export async function analyzeZipBuffer(buffer: Buffer): Promise<ZipAnalysisResult> {
  const zip = await JSZip.loadAsync(buffer);
  const fileNames = Object.keys(zip.files);

  // Safety checks against zip bombs and path traversal
  const MAX_FILES = 5000;
  const MAX_UNCOMPRESSED_SIZE = 100 * 1024 * 1024; // 100MB limit
  let totalFiles = 0;
  let totalSize = 0;
  const warnings: string[] = [];

  for (const name of fileNames) {
    const normalizedName = name.replace(/\\/g, '/');
    if (normalizedName.startsWith('/') || normalizedName.split('/').includes('..') || /^[A-Za-z]:\//.test(normalizedName)) {
      throw new Error(`Security Violation: Unsafe path traversal in archive entry: ${name}`);
    }
    const entry = zip.files[name];
    if (!entry.dir) {
      totalFiles++;
      // approximate uncompressed size check
      const data = (entry as any)._data;
      if (data && data.uncompressedSize) {
        totalSize += data.uncompressedSize;
      }
    }
  }

  if (totalFiles > MAX_FILES) {
    throw new Error(`Security Violation: Archive contains too many files (${totalFiles} > ${MAX_FILES})`);
  }
  if (totalSize > MAX_UNCOMPRESSED_SIZE) {
    throw new Error('Security Violation: Archive uncompressed size exceeds safe limit (100MB)');
  }

  // Look for configuration files
  let packageJsonContent: any = null;
  let hasViteConfig = false;
  let hasNextConfig = false;
  let hasDockerfile = false;
  let hasRenderYaml = false;
  let hasIndexHtml = false;
  const envVarNames = new Set<string>();

  for (const name of fileNames) {
    const lower = name.toLowerCase();
    const basename = lower.split('/').pop() || '';

    if (basename === 'package.json') {
      try {
        const text = await zip.files[name].async('string');
        packageJsonContent = JSON.parse(text);
      } catch {
        warnings.push(`Could not parse JSON in ${name}`);
      }
    } else if (basename.startsWith('vite.config')) {
      hasViteConfig = true;
    } else if (basename.startsWith('next.config')) {
      hasNextConfig = true;
    } else if (basename === 'dockerfile') {
      hasDockerfile = true;
    } else if (basename === 'render.yaml') {
      hasRenderYaml = true;
    } else if (basename === 'index.html') {
      hasIndexHtml = true;
    } else if (basename === '.env.example' || basename === '.env.sample' || basename === '.env') {
      try {
        const envText = await zip.files[name].async('string');
        const lines = envText.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
              envVarNames.add(trimmed.slice(0, eqIdx).trim());
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // Determine project type and commands
  let projectType: ZipAnalysisResult['projectType'] = 'unknown';
  let framework = 'Generic Web';
  let buildCommand = 'npm install';
  let startCommand = 'npm start';
  let name = 'project';

  if (packageJsonContent) {
    name = packageJsonContent.name || 'node-project';
    const scripts = packageJsonContent.scripts || {};
    const deps = { ...(packageJsonContent.dependencies || {}), ...(packageJsonContent.devDependencies || {}) };

    if (hasNextConfig || deps.next) {
      projectType = 'nextjs';
      framework = 'Next.js';
      buildCommand = scripts.build ? 'npm run build' : 'next build';
      startCommand = scripts.start ? 'npm start' : 'next start';
    } else if (hasViteConfig || deps.vite) {
      projectType = 'react_vite';
      framework = deps.react ? 'React (Vite)' : 'Vite';
      buildCommand = scripts.build ? 'npm run build' : 'vite build';
      startCommand = scripts.preview ? 'npm run preview' : 'npx serve dist';
    } else if (deps.express || deps.fastify || deps.koa || deps['@nestjs/core']) {
      projectType = 'node_express';
      framework = 'Node.js Express API';
      buildCommand = scripts.build ? 'npm run build' : 'npm install';
      startCommand = scripts.start ? 'npm start' : 'node index.js';
    } else if (scripts.start || scripts.dev) {
      projectType = 'node_express';
      framework = 'Node.js Service';
      buildCommand = scripts.build ? 'npm run build' : 'npm install';
      startCommand = scripts.start ? 'npm start' : 'node index.js';
    }
  } else if (hasDockerfile) {
    projectType = 'docker';
    framework = 'Docker Container';
    buildCommand = '';
    startCommand = '';
    warnings.push('Dockerfile detected. Render Docker services use the Dockerfile/container configuration rather than npm build/start commands.');
  } else if (hasIndexHtml) {
    projectType = 'static';
    framework = 'Static HTML / CSS / JS';
    buildCommand = 'echo "Static build not required"';
    startCommand = '';
  }

  return {
    projectType,
    framework,
    name,
    detectedBuildCommand: buildCommand,
    detectedStartCommand: startCommand,
    envVarNames: Array.from(envVarNames),
    hasDockerfile,
    hasRenderYaml,
    totalFiles,
    totalSize,
    warnings,
  };
}
