import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { getUserDataPath } from '../users/storage.js';

// Port range for OpenCode instances
const PORT_RANGE_START = parseInt(process.env.OPENCODE_PORT_RANGE_START) || 9000;
const PORT_RANGE_END = parseInt(process.env.OPENCODE_PORT_RANGE_END) || 10000;

// Instance health check interval
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const INSTANCE_TIMEOUT = 5 * 60 * 1000; // 5 minutes of inactivity before shutdown

/**
 * OpenCode Instance Pool Manager
 * Manages per-user OpenCode instances in multiuser mode
 */
export class OpenCodePoolManager {
  constructor() {
    // Map of userId -> Instance
    this.instances = new Map();
    
    // Port allocation tracking
    this.usedPorts = new Set();
    this.nextPort = PORT_RANGE_START;
    
    // Health check timer
    this.healthCheckTimer = null;
    
    // Event callbacks
    this.eventHandlers = {
      onInstanceCreated: [],
      onInstanceDestroyed: [],
      onInstanceError: []
    };
    
    // Start health check loop
    this.startHealthChecks();
  }
  
  /**
   * Allocate a free port from the pool
   */
  async allocatePort() {
    // Try to find an available port
    let attempts = 0;
    const maxAttempts = PORT_RANGE_END - PORT_RANGE_START;
    
    while (attempts < maxAttempts) {
      const port = this.nextPort;
      this.nextPort++;
      
      if (this.nextPort > PORT_RANGE_END) {
        this.nextPort = PORT_RANGE_START;
      }
      
      if (!this.usedPorts.has(port)) {
        // Verify port is actually available
        const isAvailable = await this.isPortAvailable(port);
        if (isAvailable) {
          this.usedPorts.add(port);
          return port;
        }
      }
      
      attempts++;
    }
    
    throw new Error('No available ports in range');
  }
  
  /**
   * Check if a port is available
   */
  async isPortAvailable(port) {
    return new Promise((resolve) => {
      const net = require('net');
      const server = net.createServer();
      
      server.once('error', () => {
        resolve(false);
      });
      
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      
      server.listen(port, '127.0.0.1');
    });
  }
  
  /**
   * Release a port back to the pool
   */
  releasePort(port) {
    this.usedPorts.delete(port);
  }
  
  /**
   * Generate secure password for OpenCode instance
   */
  generatePassword() {
    return crypto.randomBytes(32).toString('base64url');
  }
  
  /**
   * Get or create an instance for a user
   */
  async getOrCreateInstance(userId, config = {}) {
    // Check if instance already exists and is healthy
    if (this.instances.has(userId)) {
      const instance = this.instances.get(userId);
      const isHealthy = await this.checkHealth(instance);
      
      if (isHealthy) {
        // Update last activity
        instance.lastActivity = Date.now();
        return instance;
      }
      
      // Instance is dead, clean it up
      await this.destroyInstance(userId);
    }
    
    // Create new instance
    return this.createInstance(userId, config);
  }
  
  /**
   * Create a new OpenCode instance for a user
   */
  async createInstance(userId, config = {}) {
    const port = await this.allocatePort();
    const password = this.generatePassword();
    const userDataPath = getUserDataPath(userId);
    
    const opencodeDataDir = path.join(userDataPath, 'opencode');
    
    const instance = {
      id: `instance_${crypto.randomBytes(8).toString('hex')}`,
      userId,
      port,
      password,
      process: null,
      status: 'starting',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      config: {
        maxMemoryMB: config.maxMemoryMB || 2048,
        workingDir: config.workingDir || process.cwd(),
        ...config
      }
    };
    
    try {
      // Spawn OpenCode process
      instance.process = this.spawnOpenCode(instance, opencodeDataDir);
      
      // Wait for health check
      await this.waitForHealthy(instance);
      
      instance.status = 'running';
      this.instances.set(userId, instance);
      
      this.emit('onInstanceCreated', instance);
      
      console.log(`[PoolManager] Created instance for user ${userId} on port ${port}`);
      
      return instance;
    } catch (err) {
      this.releasePort(port);
      this.emit('onInstanceError', { instance, error: err });
      throw err;
    }
  }
  
  /**
   * Spawn OpenCode process
   */
  spawnOpenCode(instance, dataDir) {
    const args = [
      'serve',
      '--hostname', '127.0.0.1',
      '--port', instance.port.toString(),
      '--data-dir', dataDir
    ];
    
    // Add memory limit if supported
    if (instance.config.maxMemoryMB) {
      // Note: This might need adjustment based on actual opencode CLI options
      args.push('--max-memory', instance.config.maxMemoryMB.toString());
    }
    
    const env = {
      ...process.env,
      OPENCODE_SERVER_PASSWORD: instance.password,
      OPENCODE_USER_ID: instance.userId,
      OPENCODE_INSTANCE_ID: instance.id
    };
    
    const proc = spawn('opencode', args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });
    
    // Log output for debugging
    proc.stdout.on('data', (data) => {
      console.log(`[OpenCode:${instance.userId}] ${data.toString().trim()}`);
    });
    
    proc.stderr.on('data', (data) => {
      console.error(`[OpenCode:${instance.userId}] ${data.toString().trim()}`);
    });
    
    proc.on('exit', (code) => {
      console.log(`[OpenCode:${instance.userId}] Process exited with code ${code}`);
      instance.status = code === 0 ? 'stopped' : 'error';
    });
    
    return proc;
  }
  
  /**
   * Wait for instance to become healthy
   */
  async waitForHealthy(instance, timeout = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        const isHealthy = await this.checkHealth(instance);
        if (isHealthy) {
          return;
        }
      } catch {
        // Not ready yet
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    throw new Error('Instance failed to become healthy within timeout');
  }
  
  /**
   * Check if instance is healthy
   */
  async checkHealth(instance) {
    if (!instance || !instance.port) {
      return false;
    }
    
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      
      const response = await fetch(`http://127.0.0.1:${instance.port}/global/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Basic ${Buffer.from(`opencode:${instance.password}`).toString('base64')}`
        },
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        return false;
      }
      
      const data = await response.json().catch(() => null);
      return data?.healthy === true;
    } catch {
      return false;
    }
  }
  
  /**
   * Destroy an instance
   */
  async destroyInstance(userId) {
    const instance = this.instances.get(userId);
    
    if (!instance) {
      return false;
    }
    
    console.log(`[PoolManager] Destroying instance for user ${userId}`);
    
    // Kill process
    if (instance.process) {
      instance.process.kill('SIGTERM');
      
      // Force kill after timeout
      setTimeout(() => {
        if (instance.process && !instance.process.killed) {
          instance.process.kill('SIGKILL');
        }
      }, 5000);
    }
    
    // Release port
    this.releasePort(instance.port);
    
    // Remove from map
    this.instances.delete(userId);
    
    instance.status = 'destroyed';
    this.emit('onInstanceDestroyed', instance);
    
    return true;
  }
  
  /**
   * Get instance info
   */
  getInstance(userId) {
    return this.instances.get(userId) || null;
  }
  
  /**
   * List all instances
   */
  listInstances() {
    return Array.from(this.instances.values()).map(instance => ({
      id: instance.id,
      userId: instance.userId,
      port: instance.port,
      status: instance.status,
      createdAt: instance.createdAt,
      lastActivity: instance.lastActivity,
      config: {
        maxMemoryMB: instance.config.maxMemoryMB
      }
    }));
  }
  
  /**
   * Proxy request to user's instance
   */
  async proxyRequest(userId, reqPath, options = {}) {
    const instance = await this.getOrCreateInstance(userId);
    
    const url = `http://127.0.0.1:${instance.port}${reqPath}`;
    const headers = {
      ...options.headers,
      'Authorization': `Basic ${Buffer.from(`opencode:${instance.password}`).toString('base64')}`
    };
    
    return fetch(url, {
      ...options,
      headers
    });
  }
  
  /**
   * Start health check loop
   */
  startHealthChecks() {
    this.healthCheckTimer = setInterval(async () => {
      const now = Date.now();
      
      for (const [userId, instance] of this.instances.entries()) {
        // Skip if already stopping
        if (instance.status === 'stopping' || instance.status === 'destroyed') {
          continue;
        }
        
        // Check if instance is still healthy
        const isHealthy = await this.checkHealth(instance);
        
        if (!isHealthy) {
          console.log(`[PoolManager] Instance for user ${userId} is unhealthy, destroying`);
          await this.destroyInstance(userId);
          continue;
        }
        
        // Check for inactivity timeout
        if (now - instance.lastActivity > INSTANCE_TIMEOUT) {
          console.log(`[PoolManager] Instance for user ${userId} timed out due to inactivity`);
          await this.destroyInstance(userId);
        }
      }
    }, HEALTH_CHECK_INTERVAL);
  }
  
  /**
   * Stop health checks
   */
  stopHealthChecks() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
  
  /**
   * Register event handler
   */
  on(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].push(handler);
    }
  }
  
  /**
   * Emit event
   */
  emit(event, data) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].forEach(handler => {
        try {
          handler(data);
        } catch (err) {
          console.error(`[PoolManager] Event handler error:`, err);
        }
      });
    }
  }
  
  /**
   * Dispose all instances and cleanup
   */
  async dispose() {
    console.log('[PoolManager] Disposing all instances...');
    
    this.stopHealthChecks();
    
    const destroyPromises = [];
    for (const userId of this.instances.keys()) {
      destroyPromises.push(this.destroyInstance(userId));
    }
    
    await Promise.all(destroyPromises);
    
    console.log('[PoolManager] All instances disposed');
  }
  
  /**
   * Get instance statistics
   */
  getStats() {
    const instances = this.listInstances();
    
    return {
      totalInstances: instances.length,
      runningInstances: instances.filter(i => i.status === 'running').length,
      usedPorts: this.usedPorts.size,
      availablePorts: PORT_RANGE_END - PORT_RANGE_START - this.usedPorts.size,
      instances: instances
    };
  }
}

// Export singleton instance
export const poolManager = new OpenCodePoolManager();

export default poolManager;
