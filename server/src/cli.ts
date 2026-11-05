import { jobs, telegram } from './config.ts'
import { openDb } from './db.ts'
import { repo as makeRepo } from './repo.ts'
import { runJob } from './scanner.ts'
import { makeAdapters } from './sources/index.ts'

/**
 * pnpm scan-once [jobId…]: run jobs once and print the results. Use it to check the collectors against the live stores.
 * pnpm telegram-setup: find your private chat id with the bot, and check that the bot can post to the public channel.
 */
const [cmd, ...ids] = process.argv.slice(2)

async function tg<T>(method: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]))
  const res = await fetch(`https://api.telegram.org/bot${telegram.token}/${method}?${qs}`)
  const data = (await res.json()) as { ok: boolean; result: T; description?: string }
  if (!data.ok) throw new Error(`${method}: ${data.description}`)
  return data.result
}

if (cmd === 'scan-once') {
  const db = openDb()
  const repo = makeRepo(db)
  const adapters = makeAdapters()
  const selected = ids.length ? jobs.filter((j) => ids.includes(j.id)) : jobs
  for (const job of selected) {
    const r = await runJob({ db, repo, adapters, now: () => Date.now() }, job, Date.now())
    console.log(job.id.padEnd(22), r.status.padEnd(8), `pages ${r.pagesOk}/${r.pagesPlanned}`, `read ${r.productsRead}`, `new ${r.productsNew}`, `offers ${r.offersFound}`, r.error ?? '')
  }
} else if (cmd === 'telegram-setup') {
  if (!telegram.token) {
    console.log('Set TELEGRAM_BOT_TOKEN in server/.env first.')
    process.exit(1)
  }
  const me = await tg<{ id: number; username: string }>('getMe')
  console.log(`Bot: @${me.username}`)

  const updates = await tg<{ message?: { chat: { id: number; type: string; first_name?: string; username?: string } } }[]>('getUpdates')
  const chats = new Map<number, string>()
  for (const u of updates) if (u.message?.chat.type === 'private') chats.set(u.message.chat.id, u.message.chat.first_name ?? u.message.chat.username ?? '')
  if (chats.size) {
    console.log('\nPrivate chats with the bot (use one as TELEGRAM_PRIORITY_CHAT_ID):')
    for (const [id, name] of chats) console.log(`  ${id}  ${name}`)
  } else console.log(`\nNo private chat yet: open t.me/${me.username}, press Start, then run this again.`)

  if (telegram.generalChatId) {
    try {
      const member = await tg<{ status: string; can_post_messages?: boolean }>('getChatMember', { chat_id: telegram.generalChatId, user_id: me.id })
      const ok = member.status === 'creator' || (member.status === 'administrator' && member.can_post_messages !== false)
      console.log(`\nChannel ${telegram.generalChatId}: bot is ${member.status}${ok ? ', can post ✓' : '. Make it an admin with "Post messages" ✗'}`)
    } catch (e) {
      console.log(`\nChannel ${telegram.generalChatId}: ${(e as Error).message}. Add the bot to the channel as an admin.`)
    }
  }
  if (ids[0] === '--test') {
    for (const [label, chat] of [['priority', telegram.priorityChatId], ['general', telegram.generalChatId]])
      if (chat) {
        await tg('sendMessage', { chat_id: chat, text: `✅ Deal Radar test message (${label})` }).then(
          () => console.log(`Sent test to ${label}`),
          (e) => console.log(`Test to ${label} failed: ${(e as Error).message}`),
        )
      }
  }
} else {
  console.log('usage: scan-once [jobId…] | telegram-setup [--test]')
  process.exit(1)
}
