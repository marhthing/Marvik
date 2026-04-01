// memory.js - Plugin to show current memory usage and system info
import os from 'os';
import fs from 'fs';

// Helper to read cgroup memory limits
const getContainerMemory = () => {
  try {
    // Try cgroup v2 first
    const memMax = '/sys/fs/cgroup/memory.max';
    const memCurrent = '/sys/fs/cgroup/memory.current';
    
    if (fs.existsSync(memMax)) {
      const max = fs.readFileSync(memMax, 'utf8').trim();
      const current = fs.readFileSync(memCurrent, 'utf8').trim();
      return {
        total: max === 'max' ? os.totalmem() : parseInt(max),
        used: parseInt(current)
      };
    }
    
    // Try cgroup v1
    const memLimit = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
    const memUsage = '/sys/fs/cgroup/memory/memory.usage_in_bytes';
    
    if (fs.existsSync(memLimit)) {
      const limit = parseInt(fs.readFileSync(memLimit, 'utf8').trim());
      const usage = parseInt(fs.readFileSync(memUsage, 'utf8').trim());
      
      // If limit is huge (> 100GB), assume no cgroup limit
      const total = limit > 100 * 1024 * 1024 * 1024 ? os.totalmem() : limit;
      return { total, used: usage };
    }
  } catch (err) {
    // Fallback to os module
  }
  
  return {
    total: os.totalmem(),
    used: os.totalmem() - os.freemem()
  };
};

export default {
  name: 'memory',
  description: 'Show current memory usage and system info',
  version: '1.0.0',
  author: 'Are Martins',
  commands: [
    {
      name: 'memory',
      aliases: ['mem', 'ram', 'meminfo'],
      description: 'Show current memory usage and system info',
      usage: '.memory',
      category: 'utility',
      ownerOnly: false,
      adminOnly: false,
      groupOnly: false,
      cooldown: 2,
      async execute(ctx) {
        const processMem = process.memoryUsage();
        const containerMem = getContainerMemory();
        const cpus = os.cpus();
        const platform = os.platform();
        const arch = os.arch();
        const uptime = os.uptime();
        
        const formatMB = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;
        const formatGB = (bytes) => `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
        
        const totalMem = containerMem.total;
        const usedMem = containerMem.used;
        const freeMem = totalMem - usedMem;
        const freePercent = ((freeMem / totalMem) * 100).toFixed(2);
        
        const msg = `
*Bot Process Memory Usage:*
- RSS: ${formatMB(processMem.rss)}
- Heap Total: ${formatMB(processMem.heapTotal)}
- Heap Used: ${formatMB(processMem.heapUsed)}
- External: ${formatMB(processMem.external)}
- Array Buffers: ${formatMB(processMem.arrayBuffers)}

*System Info:*
- Platform: ${platform} ${arch}
- Uptime: ${(uptime/3600).toFixed(2)} hours
- CPU: ${cpus[0]?.model || 'Unknown'} (${cpus.length} cores)

*Container Memory:*
- Used: ${formatMB(usedMem)}
- Free: ${formatMB(freeMem)}
- Total: ${formatMB(totalMem)}
- Free %: ${freePercent}%
`;
        await ctx.reply(msg.trim());
      }
    }
  ]
};
