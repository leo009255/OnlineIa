const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.84';
const MODEL_ID = "SmolLM2-1.7B-Instruct-q4f16_1-MLC";
const BASE_SYSTEM_PROMPT = `
Você é uma companhia de conversa local e privada, executada no aparelho do usuário.

Regras:
- Responda em português brasileiro, salvo quando o usuário pedir outro idioma.
- Fale de forma natural, informal, direta e bem-humorada.
- Prefira respostas curtas ou médias.
- Em cumprimentos simples, responda de forma curta e coerente.
- Não invente fatos pessoais, lembranças ou experiências.
- Quando não entender, peça que o usuário reformule.
- Não pesquise na internet e não finja ter pesquisado.
- Não afirme possuir sentimentos ou consciência.
`.trim();

const CONTEXT_MESSAGES = 8;

const elements = {
  chatHistory: document.getElementById('chat-history'),
  aiStatus: document.getElementById('ai-status'),
  statusDot: document.getElementById('status-dot'),
  downloadProgress: document.getElementById('download-progress'),
  inputArea: document.getElementById('input-area'),
  userInput: document.getElementById('user-input'),
  sendBtn: document.getElementById('send-btn'),
  newChatBtn: document.getElementById('new-chat-btn'),
};

let engine = null;
let isGenerating = false;
let conversation = [];

function describeError(error) {
  if (error instanceof Error) {
    const details = [error.name, error.message].filter(Boolean).join(': ');
    return details || String(error);
  }

  if (typeof error === 'string') return error;
  if (error === null) return 'Erro nulo recebido.';
  if (error === undefined) return 'Erro sem detalhes recebido.';

  try {
    const json = JSON.stringify(error, Object.getOwnPropertyNames(error));
    return json && json !== '{}' ? json : String(error);
  } catch {
    return String(error);
  }
}

function setStatus(text, state = 'loading') {
  elements.aiStatus.textContent = text;
  elements.statusDot.dataset.state = state;
}

function setReady(ready) {
  elements.userInput.disabled = !ready;
  elements.sendBtn.disabled = !ready;
  elements.newChatBtn.disabled = !ready;

  if (ready) {
    elements.userInput.focus();
  }
}

function addMessage(role, text = '') {
  const message = document.createElement('div');
  message.className = `message ${role}-message`;
  message.textContent = text;
  elements.chatHistory.appendChild(message);
  elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
  return message;
}

function resizeInput() {
  elements.userInput.style.height = 'auto';
  elements.userInput.style.height = `${Math.min(elements.userInput.scrollHeight, 140)}px`;
}

function startNewChat(showMessage = true) {
  if (isGenerating) return;

  conversation = [];
  elements.chatHistory.replaceChildren();

  if (showMessage) {
    addMessage(
      'assistant',
      'Novo chat iniciado. Esta conversa existe apenas enquanto esta página estiver aberta.',
    );
  }

  elements.userInput.value = '';
  resizeInput();
  elements.userInput.focus();
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    await navigator.serviceWorker.register('./sw.js?v=7');
  } catch (error) {
    console.warn('Service Worker não registrado:', error);
  }
}

async function verifyWebGPU() {
  if (!window.isSecureContext) {
    throw new Error('Esta página precisa ser aberta por HTTPS.');
  }

  if (!('gpu' in navigator)) {
    throw new Error('WebGPU não está disponível neste navegador.');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('O navegador não conseguiu criar um adaptador WebGPU compatível.');
  }
}

async function init() {
  try {
    setReady(false);
    setStatus('Verificando WebGPU...');
    await verifyWebGPU();

    await registerServiceWorker();

    setStatus('Carregando biblioteca da IA...');
    const webllm = await import(WEBLLM_URL);

    if (typeof webllm.CreateMLCEngine !== 'function') {
      throw new Error('A biblioteca WebLLM foi carregada sem CreateMLCEngine.');
    }

    elements.downloadProgress.hidden = false;
    setStatus('Preparando Llama 3.2 1B...');

    engine = await webllm.CreateMLCEngine(SELECTED_MODEL, {
      initProgressCallback(report) {
        const progress = typeof report?.progress === 'number' ? report.progress : 0;
        const percent = Math.round(progress * 100);

        elements.downloadProgress.value = percent;
        setStatus(report?.text || `Carregando modelo: ${percent}%`);
      },
    });

    elements.downloadProgress.hidden = true;
    setStatus('Online e funcionando localmente', 'ready');
    setReady(true);
    startNewChat(false);

    addMessage(
      'assistant',
      'Pronto. Cada chat começa do zero e não é salvo. O modelo continua armazenado no navegador.',
    );
  } catch (error) {
    console.error('Falha na inicialização:', error);

    const details = describeError(error);
    elements.downloadProgress.hidden = true;
    setStatus(`Erro: ${details}`, 'error');
    addMessage('assistant', `Não consegui iniciar.\n\n${details}`);
  }
}

async function sendMessage() {
  const text = elements.userInput.value.trim();

  if (!text || !engine || isGenerating) return;

  isGenerating = true;
  setReady(false);

  elements.userInput.value = '';
  resizeInput();

  addMessage('user', text);
  conversation.push({ role: 'user', content: text });

  const assistantMessage = addMessage('assistant', '');
  let assistantText = '';

  try {
    const context = conversation.slice(-CONTEXT_MESSAGES);

    const chunks = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: BASE_SYSTEM_PROMPT },
        ...context,
      ],
      stream: true,
      temperature: 0.35,
      top_p: 0.9,
      max_tokens: 220,
    });

    for await (const chunk of chunks) {
      const piece = chunk.choices?.[0]?.delta?.content || '';
      assistantText += piece;
      assistantMessage.textContent = assistantText;
      elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
    }

    const finalText =
      assistantText.trim() ||
      'Não consegui formar uma resposta. Tente escrever de outra forma.';

    assistantMessage.textContent = finalText;
    conversation.push({ role: 'assistant', content: finalText });

    setStatus('Online e funcionando localmente', 'ready');
  } catch (error) {
    const details = describeError(error);
    console.error('Falha ao gerar resposta:', error);

    assistantMessage.textContent = `Erro ao gerar resposta: ${details}`;
    setStatus(`Erro: ${details}`, 'error');
  } finally {
    isGenerating = false;
    setReady(true);
  }
}

elements.inputArea.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage();
});

elements.userInput.addEventListener('input', resizeInput);

elements.userInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

elements.newChatBtn.addEventListener('click', () => {
  startNewChat(true);
});

init();
