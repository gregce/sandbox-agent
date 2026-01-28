'use client';

import { useState } from 'react';
import { Terminal, Check, ArrowRight } from 'lucide-react';

const CopyInstallButton = () => {
  const [copied, setCopied] = useState(false);
  const installCommand = 'npx skills add https://sandboxagent.dev/docs';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className='inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm text-white subpixel-antialiased shadow-sm transition-colors hover:border-white/20'
    >
      {copied ? <Check className='h-4 w-4' /> : <Terminal className='h-4 w-4' />}
      {installCommand}
    </button>
  );
};

export function Hero() {
  return (
    <section className="relative pt-44 pb-24 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="flex flex-col lg:flex-row items-center gap-16">
          <div className="flex-1 text-center lg:text-left">
            <h1 className="mb-6 text-5xl font-medium leading-[1.1] tracking-tighter text-white md:text-7xl">
              Universal API for <br />
              Coding Agents
            </h1>
            <p className="mt-8 text-xl text-zinc-400 leading-relaxed max-w-2xl mx-auto lg:mx-0">
              One SDK to control Claude Code, Codex, OpenCode, and Amp. Unified events, session management, and human-in-the-loop. Swap agents with zero refactoring.
            </p>

            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center lg:justify-start">
              <a
                href="/docs"
                className='inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-white/10 bg-white px-4 py-2 text-sm text-black subpixel-antialiased shadow-sm transition-colors hover:bg-zinc-200'
              >
                Read the Docs
                <ArrowRight className='h-4 w-4' />
              </a>
              <CopyInstallButton />
            </div>
          </div>

          <div className="flex-1 w-full max-w-xl">
            <div className="relative group">
              <div className="absolute -inset-1 rounded-xl bg-gradient-to-r from-zinc-700 to-zinc-800 opacity-20 blur" />
              <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-zinc-900/50 shadow-2xl backdrop-blur-xl">
                <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-3 w-3 rounded-full border border-zinc-500/50 bg-zinc-500/20" />
                    <div className="h-3 w-3 rounded-full border border-zinc-500/50 bg-zinc-500/20" />
                    <div className="h-3 w-3 rounded-full border border-zinc-500/50 bg-zinc-500/20" />
                  </div>
                  <div className="font-mono text-xs text-zinc-500">example_agent.ts</div>
                </div>
                <pre className="overflow-x-auto p-6 font-mono text-sm leading-relaxed">
                  <code>
                    <span className="text-purple-400">const</span>
                    <span className="text-zinc-300"> agents = </span>
                    <span className="text-purple-400">await</span>
                    <span className="text-zinc-300"> client.</span>
                    <span className="text-blue-400">listAgents</span>
                    <span className="text-zinc-300">();</span>
                    {"\n\n"}
                    <span className="text-purple-400">await</span>
                    <span className="text-zinc-300"> client.</span>
                    <span className="text-blue-400">createSession</span>
                    <span className="text-zinc-300">(</span>
                    <span className="text-green-400">"demo"</span>
                    <span className="text-zinc-300">{", {"}</span>
                    {"\n"}
                    <span className="text-zinc-300">{"  agent: "}</span>
                    <span className="text-green-400">"codex"</span>
                    <span className="text-zinc-300">,</span>
                    {"\n"}
                    <span className="text-zinc-300">{"  agentMode: "}</span>
                    <span className="text-green-400">"default"</span>
                    <span className="text-zinc-300">,</span>
                    {"\n"}
                    <span className="text-zinc-300">{"  permissionMode: "}</span>
                    <span className="text-green-400">"plan"</span>
                    <span className="text-zinc-300">,</span>
                    {"\n"}
                    <span className="text-zinc-300">{"});"}</span>
                    {"\n\n"}
                    <span className="text-purple-400">await</span>
                    <span className="text-zinc-300"> client.</span>
                    <span className="text-blue-400">postMessage</span>
                    <span className="text-zinc-300">(</span>
                    <span className="text-green-400">"demo"</span>
                    <span className="text-zinc-300">{", { message: "}</span>
                    <span className="text-green-400">"Hello from the SDK."</span>
                    <span className="text-zinc-300">{" });"}</span>
                    {"\n\n"}
                    <span className="text-purple-400">for await</span>
                    <span className="text-zinc-300"> (</span>
                    <span className="text-purple-400">const</span>
                    <span className="text-zinc-300"> event </span>
                    <span className="text-purple-400">of</span>
                    <span className="text-zinc-300"> client.</span>
                    <span className="text-blue-400">streamEvents</span>
                    <span className="text-zinc-300">(</span>
                    <span className="text-green-400">"demo"</span>
                    <span className="text-zinc-300">{", { offset: "}</span>
                    <span className="text-amber-400">0</span>
                    <span className="text-zinc-300">{" })) {"}</span>
                    {"\n"}
                    <span className="text-zinc-300">{"  console."}</span>
                    <span className="text-blue-400">log</span>
                    <span className="text-zinc-300">(event.type, event.data);</span>
                    {"\n"}
                    <span className="text-zinc-300">{"}"}</span>
                  </code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

