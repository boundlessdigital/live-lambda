import { createServer, ViteDevServer } from 'vite';
import path from 'path';
import { initializeAppSyncClient, closeAppSyncClient } from './appsync-client';
import { LambdaManifest } from './types';
import { loadLambdaManifest } from './manifest-loader';
import { config } from './config';
import { deployAndRetrieveAppSyncOutputs } from './infrastructure-manager';

let viteServer: ViteDevServer | null = null;

async function _initializeViteServer(): Promise<ViteDevServer | null> {
  try {
    const server = await createServer({
      root: config.server.rootPath,
      server: {
        port: config.server.port,
      },
      logLevel: 'info',
    });
    await server.listen();
    console.log(`Vite dev server started. Ready to load Lambda handlers.`);
    server.printUrls();
    return server;
  } catch (e) {
    console.error('Failed to start Vite server:', e);
    return null;
  }
}

async function startServer() {
  const lambdaManifest: LambdaManifest = await loadLambdaManifest();

  viteServer = await _initializeViteServer();

  if (!viteServer) {
    process.exit(1); // Exit if Vite server failed to start
  }

  // Attempt to deploy AppSyncStack and get outputs
  console.log('Attempting to deploy AppSync infrastructure and retrieve outputs...');
  const appSyncOutputs = await deployAndRetrieveAppSyncOutputs();

  let effectiveAppSyncUrl: string;
  let effectiveAppSyncHost: string;
  const effectiveRegion = config.aws.region; // Region is from general AWS config

  if (appSyncOutputs && appSyncOutputs.LiveLambdaEventApiWebSocketEndpoint && appSyncOutputs.appSyncHost) {
    console.log('Using dynamically retrieved AppSync outputs for client initialization.');
    effectiveAppSyncUrl = appSyncOutputs.LiveLambdaEventApiWebSocketEndpoint;
    effectiveAppSyncHost = appSyncOutputs.appSyncHost;
  } else {
    console.warn('Failed to retrieve dynamic AppSync outputs or outputs were incomplete. Falling back to .env configuration.');
    effectiveAppSyncUrl = config.appSync.realtimeEndpointWss;
    effectiveAppSyncHost = config.appSync.host;
  }

  if (effectiveAppSyncUrl && effectiveAppSyncHost && effectiveRegion && Object.keys(lambdaManifest).length > 0) {
    await initializeAppSyncClient(
      lambdaManifest,
      viteServer,
      effectiveAppSyncUrl,
      effectiveAppSyncHost,
      effectiveRegion
    );
  } else {
    if (Object.keys(lambdaManifest).length === 0) {
      console.warn('Lambda manifest is empty or could not be loaded. AppSync client will not be initialized. Run cdk synth.');
    } else {
      console.error('Critical AppSync configuration (URL, Host, or Region) is missing even after attempting dynamic retrieval and fallback. AppSync client will not be initialized.');
    }
    // Note: Server continues to run even if AppSync client isn't initialized, change if this is not desired.
  }
}

startServer().catch(error => {
  console.error('Unhandled error during server startup:', error);
  process.exit(1);
});

// Graceful shutdown handler
process.on('SIGINT', async () => {
  console.log('\nGracefully shutting down...');
  if (viteServer) {
    await viteServer.close();
  }
  closeAppSyncClient();
  process.exit(0);
});
