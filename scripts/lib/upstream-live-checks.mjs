import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

// Only decode complete frames. A live log may end partway through its next
// atomic append; the next poll will read it after the writer finishes.
function decodeLog(buffer, compressed) {
  if (!compressed) return buffer.toString('utf8')
  const parts = []
  let offset = 0
  scan: while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 5) break
    assert.equal(buffer.readUInt32LE(offset), 0xfd2fb528, 'QA log has an invalid Zstandard frame')
    const descriptor = buffer[offset + 4]
    assert.equal(descriptor & 24, 0, 'QA log has unsupported frame flags')
    const sizeFlag = descriptor >>> 6
    const single = Boolean(descriptor & 32)
    const dictionary = descriptor & 3
    offset += 5 + (single ? 0 : 1) + (dictionary === 3 ? 4 : dictionary) + (sizeFlag === 0 ? single ? 1 : 0 : 1 << sizeFlag)
    if (offset > buffer.length) break
    for (;;) {
      if (buffer.length - offset < 3) break scan
      const block = buffer.readUIntLE(offset, 3)
      offset += 3
      const type = (block >>> 1) & 3
      assert.notEqual(type, 3, 'QA log has an invalid Zstandard block')
      offset += type === 1 ? 1 : block >>> 3
      if (offset > buffer.length) break scan
      if (block & 1) break
    }
    if (descriptor & 4) offset += 4
    if (offset > buffer.length) break
    parts.push(zstdDecompressSync(buffer.subarray(start, offset)))
  }
  return Buffer.concat(parts).toString('utf8')
}

async function sessionEvents(dshHome, sessionId) {
  const candidates = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true }).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (basename(directory) === sessionId && /^session\.v4\.jsonl(?:\.zstd)?$/.test(entry.name)) candidates.push(path)
    }
  }
  await walk(join(dshHome, 'sessions'))
  if (candidates.length === 0) return []
  assert.equal(candidates.length, 1, 'QA session has an ambiguous log')
  const file = candidates[0]
  const raw = decodeLog(await readFile(file), file.endsWith('.zstd'))
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line))
}

function assistantText(events, turn) {
  return events.filter(event => event.type === 'assistant/message' && event.data?.turn === turn)
    .flatMap(event => event.data?.message?.content ?? [])
    .filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
}

/** Opt-in acceptance with an explicitly supplied endpoint and credential.
 * The caller owns run isolation, sanitization, cleanup and network auditing.
 * No model response, request body, credential or endpoint enters this result.
 */
export async function runLiveChecks(hooks) {
  const { config, main, guest, waitFor, action, navigate, modelPanel, closeSettings,
    snapshot, insertDraft, conversationReady, workspaceReady, attachGuest,
    project, dshHome, reportDir, check } = hooks
  assert.ok(config && typeof config.apiKey === 'string' && config.apiKey.length > 0, 'Live acceptance needs an explicit API key')
  assert.ok(typeof config.baseURL === 'string' && typeof config.model === 'string' && config.model.length > 0, 'Live acceptance needs an explicit endpoint and model')
  assert.ok(config.api === 'openai-completions', 'This live acceptance currently supports Chat Completions')
  const provider = 'studio-acceptance'
  const index = 2
  const preserved = [await snapshot(0), await snapshot(1)]
  const report = { model: config.model, configuredThroughOfficialForm: false, modelSelected: false,
    firstAnswer: false, multiTurnHistory: false, skillCreated: false, skillMenuVisible: false,
    skillCalled: false, skillInvocationMode: null, fileRead: false, markerReturned: false,
    promptsSubmitted: 0, toolNames: [], originalDraftsPreserved: false }
  const keepOriginalDrafts = async () => {
    for (let tab = 0; tab < 2; tab++) assert.ok(JSON.stringify(await snapshot(tab)) === JSON.stringify(preserved[tab]), 'An original QA tab changed during live acceptance')
  }
  const cardExpression = `(() => { const route = document.querySelector('[data-shortcut-modal="settings"] input[aria-label="Provider ID"]'); let card=route?.parentElement; while(card && !card.querySelector('select[aria-label="API 协议"],select[aria-label="API protocol"]')) card=card.parentElement; return card })()`
  const setField = async (labels, value, tag = 'input') => {
    const ok = await guest(index, `(() => { const card=${cardExpression}; const el=[...(card?.querySelectorAll(${JSON.stringify(tag)})||[])].find(el=>${JSON.stringify(labels)}.includes(el.getAttribute('aria-label'))); if(!el||el.disabled) return false; Object.getOwnPropertyDescriptor(${tag === 'select' ? 'HTMLSelectElement' : 'HTMLInputElement'}.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event(${JSON.stringify(tag === 'select' ? 'change' : 'input')},{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); return true })()`)
    assert.ok(ok, 'The expected official model field was unavailable')
  }
  const clickCardButton = async labels => {
    const ok = await guest(index, `(() => {const card=${cardExpression};const matches=[...(card?.querySelectorAll('button')||[])].filter(el=>${JSON.stringify(labels)}.includes(el.textContent.trim())&&!el.disabled);if(matches.length!==1)return false;matches[0].click();return true})()`)
    assert.ok(ok, 'The expected official model form action was unavailable')
  }

  await check('Live provider is configured through Studio and the official custom model form', async () => {
    await navigate('workspace')
    await action('new-tab')
    await waitFor('third QA guest', () => main('document.querySelectorAll("webview").length===3'))
    await waitFor('third official launcher', () => guest(index, 'Boolean(document.querySelector("[data-slot=\\"settings.launcher\\"] button"))'), 45000)
    await attachGuest(index)
    const later = await modelPanel(index, 'later')
    assert.ok(later.status === 'opened', 'The fresh QA tab onboarding could not be dismissed')
    await action('open-workspace', { id: 'qa-upstream' })
    await conversationReady(index)
    await workspaceReady(index)
    const opened = await modelPanel(index, 'custom')
    assert.ok(opened.status === 'opened', 'The official custom model entry did not open')
    await setField(['Provider ID'], provider)
    await setField(['显示名称', 'Display name'], 'Studio acceptance')
    await setField(['API 地址', 'Base URL'], config.baseURL)
    await setField(['API 协议', 'API protocol'], config.api, 'select')
    await setField(['API 密钥', 'API key'], config.apiKey)
    await clickCardButton(['添加模型', 'Add model'])
    await setField(['模型 ID 1', 'Model ID 1'], config.model)
    await setField(['显示名称 1', 'Display name 1'], config.model)
    await guest(index, `(() => {const card=${cardExpression};const button=[...(card?.querySelectorAll('button')||[])].find(el=>/^(模型选项|Model options) 1$/.test(el.getAttribute('aria-label')||''));if(!button)throw new Error('Official model options unavailable');button.click();return true})()`)
    await setField(['最大输出 token 数 1', 'Max output tokens 1'], '1024')
    await guest(index, `(() => {const card=${cardExpression};const field=[...(card?.querySelectorAll('input')||[])].find(el=>/^(最大输出 token 数|Max output tokens) 1$/.test(el.getAttribute('aria-label')||''));field?.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));return true})()`)
    await clickCardButton(['创建提供商', 'Create provider'])
    await waitFor('official provider created', () => guest(index, `!document.querySelector('[data-shortcut-modal="settings"] input[aria-label="Provider ID"]') && document.querySelector('[data-slot="settings.section"]')?.textContent.includes('Studio acceptance')`), 45000)
    await closeSettings(index)
    await conversationReady(index)
    await keepOriginalDrafts()
    report.configuredThroughOfficialForm = true
    return { configuredThroughOfficialForm: true, model: config.model }
  })

  // Explicitly create a fresh session with the official New Session action.
  // This avoids inheriting a blank session or draft from another guest.
  const inherited = await snapshot(index)
  await guest(index, `(() => { const buttons=[...document.querySelectorAll('button')].filter(el=>/^(新建会话|新会话|New Session)$/i.test(el.getAttribute('aria-label')||'')&&!el.disabled); if(buttons.length!==1)throw new Error('Official New Session action unavailable');buttons[0].click();return true })()`)
  await waitFor('fresh live session', async () => { const state=await snapshot(index); return state.sessionId && state.sessionId !== inherited.sessionId && preserved.every(tab=>tab.sessionId!==state.sessionId) }, 30000)
  await conversationReady(index)
  const sessionId = (await snapshot(index)).sessionId

  await check('The explicit live model can be selected in the official composer', async () => {
    await guest(index, `(() => { const trigger=[...document.querySelectorAll('button[aria-haspopup="menu"]')].find(el=>/^(请选择模型|选择模型，|Select model)/.test(el.getAttribute('aria-label')||'')); if(!trigger||trigger.disabled)throw new Error('Official model selector unavailable');trigger.click();return true })()`)
    await waitFor('live model choice', async () => guest(index, `(() => { const match=[...document.querySelectorAll('[data-provider-id][data-model-id]')].find(el=>el.getAttribute('data-provider-id')===${JSON.stringify(provider)}&&el.getAttribute('data-model-id')===${JSON.stringify(config.model)}&&el.closest('[role="menuitemradio"]'));if(match){match.closest('button').click();return true}const drill=[...document.querySelectorAll('button[role="menuitem"]')].find(el=>/^(模型|Model)/.test(el.textContent.trim()));if(drill)drill.click();return false })()`), 30000)
    await waitFor('live model selected', () => guest(index, `Boolean([...document.querySelectorAll('button[aria-haspopup="menu"] [data-provider-id][data-model-id]')].find(el=>el.getAttribute('data-provider-id')===${JSON.stringify(provider)}&&el.getAttribute('data-model-id')===${JSON.stringify(config.model)}))`), 30000)
    report.modelSelected = true
    return { modelSelected: true, model: config.model }
  })

  const submit = async (prompt, label) => {
    assert.ok(report.promptsSubmitted < 3, 'Live acceptance prompt limit reached')
    assert.ok((await snapshot(index)).sessionId === sessionId, 'Live session changed before submission')
    await keepOriginalDrafts()
    const prior = await sessionEvents(dshHome, sessionId)
    const priorEnds = prior.filter(event=>event.type==='turn/end').length
    const sent = await main('window.studio.quickAsk.submit('+JSON.stringify(prompt)+',{autoSend:true,reveal:false})')
    assert.ok(sent?.status === 'sent', 'Live prompt was not sent; no retry was attempted')
    report.promptsSubmitted++
    const events = await waitFor(label, async () => {
      const next=await sessionEvents(dshHome,sessionId)
      const ends=next.filter(event=>event.type==='turn/end')
      return ends.length>priorEnds ? next : null
    }, 240000)
    const ending=events.filter(event=>event.type==='turn/end').at(-1)
    assert.ok(ending?.data?.reason?.kind === 'completed', 'The live model turn did not complete successfully')
    await keepOriginalDrafts()
    return { events, turn: ending.data.turn }
  }
  const memoryToken = 'HS_' + randomBytes(8).toString('hex')
  await check('Live model produces a short first answer', async () => {
    const result = await submit(`This is an isolated acceptance test. Remember the token ${memoryToken}. Reply with exactly this token and nothing else. Do not use tools.`, 'first live answer completes')
    assert.ok(assistantText(result.events,result.turn).includes(memoryToken), 'The first live answer did not return the requested token')
    report.firstAnswer = true
    return { firstAnswer: true, promptsSubmitted: report.promptsSubmitted }
  })
  await check('Live model retains history across a second turn', async () => {
    const result = await submit('Return only the exact token I asked you to remember in my previous message. Do not use tools.', 'second live answer completes')
    assert.ok(assistantText(result.events,result.turn).includes(memoryToken), 'The second live answer did not retain the first-turn token')
    report.multiTurnHistory = true
    return { multiTurnHistory: true, promptsSubmitted: report.promptsSubmitted }
  })

  const suffix = randomBytes(6).toString('hex')
  const skillName = 'studio-acceptance-' + suffix
  const markerFile = 'studio-acceptance-marker-' + suffix + '.txt'
  const marker = 'READ_PROOF_' + randomBytes(24).toString('hex')
  await mkdir(join(project,'.git'), { recursive:true })
  await writeFile(join(project,markerFile), marker + '\n', { flag:'wx', encoding:'utf8' })
  await check('A skill created in Studio appears in the official slash menu', async () => {
    await navigate('skills')
    const inventory=await main('window.studio.skills.list()')
    assert.ok(resolve(inventory.projectRoot || '') === resolve(project), 'Studio skill source is outside the isolated QA project')
    const source=inventory.sources.find(source=>source.kind==='project-dsh'&&source.writable)
    assert.ok(source, 'Writable isolated project skill source unavailable')
    const content=`---\nname: ${skillName}\ndescription: Read the isolated acceptance marker using the read tool.\n---\nUse the read tool to read the file ${markerFile} in the current workspace. Return only the exact file contents. Do not use shell, network, or any other project files.\n`
    const created=await main('window.studio.skills.create('+JSON.stringify(source.id)+','+JSON.stringify(skillName)+','+JSON.stringify(content)+')')
    assert.ok(created?.skill?.valid===true, 'Studio did not create a valid acceptance skill')
    report.skillCreated=true
    await navigate('workspace')
    // DSH rc.2 caches each session's menu catalog. Reload only this guest to
    // refresh the official catalog, leaving the two original drafts mounted.
    const beforeReload = await snapshot(index)
    await main(`document.querySelectorAll('webview')[${index}].reload();true`)
    await waitFor('live guest reload',()=>guest(index,`performance.timeOrigin!==${JSON.stringify(beforeReload.timeOrigin)}&&Boolean(document.querySelector('[data-slot="settings.launcher"] button'))`),45000)
    await conversationReady(index)
    await workspaceReady(index)
    assert.ok((await snapshot(index)).sessionId===sessionId,'Live session was not restored after catalog refresh')
    await insertDraft(index, '/'+skillName)
    await waitFor('official slash skill candidate',()=>guest(index,`Boolean([...document.querySelectorAll('[role="listbox"] [role="option"]')].find(el=>el.textContent.includes(${JSON.stringify(skillName)})))`),20000)
    report.skillMenuVisible=true
    // Clear only our temporary slash query; submission below includes the full
    // explicit skill reference and remains the third and final prompt.
    await guest(index, `(() => { const editor=[...document.querySelectorAll('[data-conversation-content] [contenteditable="true"]')].find(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0});if(!editor)throw new Error('QA composer missing');editor.focus();const range=document.createRange();range.selectNodeContents(editor);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return true })()`)
    await hooks.getGuestClient(index).send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8})
    await hooks.getGuestClient(index).send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8})
    await waitFor('QA slash draft cleared',async()=>!(await snapshot(index)).draft)
    await keepOriginalDrafts()
    return { skillCreated:true,skillMenuVisible:true }
  })
  await check('Live skill invocation reads the isolated file and returns its unknown marker', async () => {
    const result=await submit(`/${skillName} Follow this skill's instructions using the read tool. Return only the marker read from the file.`, 'live skill and read tools complete')
    const calls=result.events.filter(event=>event.type==='tool/call'&&event.data?.turn===result.turn)
    const successes=result.events.filter(event=>event.type==='tool/result'&&event.data?.turn===result.turn&&event.data?.message?.role==='tool'&&!event.data.message.isError)
    const succeeded=call=>successes.some(event=>event.sourceEventSeqs?.includes(call.seq)&&event.data.message.toolCallId===call.data.callId)
    // Official rc.2 expands /name into a user/message whose data is the
    // message itself, with source {kind:'skill-invocation',name,form:'instructions'}.
    // Unlike tool events, user/message has no data.turn; bound it by event seq.
    const start=result.events.findLast(event=>event.type==='turn/start'&&event.data?.turn===result.turn)
    const end=result.events.findLast(event=>event.type==='turn/end'&&event.data?.turn===result.turn)
    const turnEvents=result.events.filter(event=>start&&end&&event.seq>=start.seq&&event.seq<=end.seq)
    const skillExpanded=turnEvents.some(event=>event.type==='user/message'&&event.data?.source?.kind==='skill-invocation'&&event.data.source.name===skillName&&event.data.source.form==='instructions')
    const skillToolCalled=calls.some(event=>event.data.name==='skill'&&event.data.arguments?.name===skillName&&succeeded(event))
    const fileRead=calls.some(event=>event.data.name==='read'&&JSON.stringify(event.data.arguments??{}).includes(markerFile)&&succeeded(event))
    const markerReturned=assistantText(result.events,result.turn).includes(marker)
    const skillInvocationMode=skillExpanded?'slash-instructions':skillToolCalled?'tool':null
    // Persist only structural evidence before assertions so a failed live run
    // remains diagnosable after its isolated credentials and raw logs are erased.
    // Call IDs are stable aliases, never raw provider values. No argument,
    // message, stream, model output, marker, endpoint or credential is copied.
    const callIds=new Map()
    const callIdAlias=value=>{
      if(typeof value!=='string')return null
      if(!callIds.has(value))callIds.set(value,`call-${callIds.size+1}`)
      return callIds.get(value)
    }
    const toolName=value=>['skill','read','bash','write','edit','glob','grep','web_search','web_fetch'].includes(value)?value:'other'
    const eventTypeCounts={}
    for(const event of result.events)eventTypeCounts[event.type]=(eventTypeCounts[event.type]??0)+1
    const evidence={
      schemaVersion:1,turn:result.turn,eventTypeCounts,
      skillExpanded,skillToolCalled,skillInvocationMode,fileRead,markerReturned,
      events:turnEvents.map(event=>{
        const data=event.data??{}
        const message=event.type==='user/message'?data:data.message
        return {
          type:event.type,seq:event.seq,dataKeys:Object.keys(data).sort(),
          turn:Number.isInteger(data.turn)?data.turn:null,
          name:event.type==='tool/call'?toolName(data.name):null,
          callId:callIdAlias(data.callId??message?.toolCallId),
          isError:typeof message?.isError==='boolean'?message.isError:null,
          sourceEventSeqs:(event.sourceEventSeqs??[]).filter(Number.isInteger),
          skillInstructionSource:message?.source?.kind==='skill-invocation'&&message.source.form==='instructions',
          skillNameMatched:message?.source?.name===skillName||data.arguments?.name===skillName,
          markerFileMatched:event.type==='tool/call'&&JSON.stringify(data.arguments??{}).includes(markerFile)
        }
      })
    }
    await mkdir(reportDir,{recursive:true})
    await writeFile(join(reportDir,'live-tool-evidence.json'),JSON.stringify(evidence,null,2)+'\n','utf8')
    assert.ok(skillExpanded||skillToolCalled,'The acceptance skill was not expanded or successfully invoked')
    assert.ok(fileRead,'The isolated marker was not read through the read tool')
    assert.ok(markerReturned,'The live assistant did not return the file marker')
    report.skillCalled=true;report.fileRead=true;report.markerReturned=true
    report.skillInvocationMode=skillInvocationMode
    report.toolNames=[...new Set(calls.map(event=>toolName(event.data.name)))].sort()
    await keepOriginalDrafts();report.originalDraftsPreserved=true
    return { skillCalled:true,skillInvocationMode,fileRead:true,markerReturned:true,toolCalls:calls.length,toolNames:report.toolNames,promptsSubmitted:report.promptsSubmitted,originalDraftsPreserved:true }
  })
  return report
}
