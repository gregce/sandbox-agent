'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const faqs = [
  {
    question: 'Does this replace the Vercel AI SDK?',
    answer:
      "No, they're complementary. AI SDK is for building chat interfaces and calling LLMs. This SDK is for controlling autonomous coding agents that write code and run commands. Use AI SDK for your UI, use this when you need an agent to actually code.",
  },
  {
    question: 'Which coding agents are supported?',
    answer:
      'Claude Code, Codex, OpenCode, and Amp. The SDK normalizes their APIs so you can swap between them without changing your code.',
  },
  {
    question: 'How is session data persisted?',
    answer:
      "Events stream in a universal JSON schema. Persist them anywhere. We have adapters for Postgres and ClickHouse, or use <a href='https://rivet.gg' target='_blank' rel='noopener noreferrer' class='text-orange-400 hover:underline'>Rivet Actors</a> for managed stateful storage.",
  },
  {
    question: 'Can I run this locally or does it require a sandbox provider?',
    answer:
      "Both. Run locally for development, deploy to E2B, Daytona, Vercel, or Docker for production.",
  },
  {
    question: 'Is this open source?',
    answer:
      "Yes, MIT licensed. Code is on GitHub.",
  },
];

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-b border-white/5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between py-5 text-left"
      >
        <span className="text-base font-medium text-white pr-4">{question}</span>
        <ChevronDown
          className={`h-5 w-5 shrink-0 text-zinc-500 transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="pb-5 text-sm leading-relaxed text-zinc-400" dangerouslySetInnerHTML={{ __html: answer }} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FAQ() {
  return (
    <section className="relative overflow-hidden border-t border-white/5 py-24">
      <div className="mx-auto max-w-3xl px-6">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-medium tracking-tight text-white">
            Frequently Asked Questions
          </h2>
          <p className="text-zinc-400">
            Common questions about the Coding Agent SDK.
          </p>
        </div>

        <div className="divide-y divide-white/5 rounded-2xl border border-white/5 bg-zinc-900/30 px-6">
          {faqs.map((faq, index) => (
            <FAQItem key={index} question={faq.question} answer={faq.answer} />
          ))}
        </div>
      </div>
    </section>
  );
}
