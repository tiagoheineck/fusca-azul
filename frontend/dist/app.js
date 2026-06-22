const { createApp, computed, onMounted, ref } = Vue;

createApp({
  setup() {
    const gatewayBase = window.location.origin;
    const callbackPath = "/auth/callback";
    const appOrigin = "http://localhost:5173";
    const callbackUrl = `${appOrigin}${callbackPath}`;
    const storageKeys = {
      token: "fusca_access_token",
      user: "fusca_user",
      exchangedCode: "fusca_google_exchanged_code",
    };

    const routePath = window.location.pathname.replace(/\/$/, "") || "/";
    const isCallback = routePath === callbackPath;

    const loadingLogin = ref(false);
    const loadingExchange = ref(false);
    const loadingProtected = ref(false);
    const statusMessage = ref("");
    const errorMessage = ref("");
    const protectedStatus = ref("");
    const protectedResult = ref("");
    const user = ref(loadUser());
    const token = ref(loadToken());
    const tokenInput = ref(loadToken());

    const isLoggedIn = computed(() => Boolean(token.value));

    function loadUser() {
      try {
        const raw = window.localStorage.getItem(storageKeys.user);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }

    function loadToken() {
      return window.localStorage.getItem(storageKeys.token) || "";
    }

    function persistSession(sessionToken, sessionUser) {
      token.value = sessionToken;
      user.value = sessionUser;
      window.localStorage.setItem(storageKeys.token, sessionToken);
      window.localStorage.setItem(storageKeys.user, JSON.stringify(sessionUser));
    }

    function clearSession() {
      token.value = "";
      user.value = null;
      protectedResult.value = "";
      window.localStorage.removeItem(storageKeys.token);
      window.localStorage.removeItem(storageKeys.user);
      window.sessionStorage.removeItem(storageKeys.exchangedCode);
    }

    function markCodeAsExchanged(code) {
      window.sessionStorage.setItem(storageKeys.exchangedCode, code);
    }

    function hasCodeBeenExchanged(code) {
      return window.sessionStorage.getItem(storageKeys.exchangedCode) === code;
    }

    function parseJsonSafe(text) {
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        return null;
      }
    }

    async function startGoogleLogin() {
      loadingLogin.value = true;
      errorMessage.value = "";
      statusMessage.value = "Solicitando URL de autenticação do Google...";

      try {
        const response = await fetch(
          `${gatewayBase}/auth-api/google/url?redirect_uri=${encodeURIComponent(callbackUrl)}`,
        );
        const text = await response.text();
        const data = parseJsonSafe(text);

        if (!response.ok || !data.auth_url) {
          const fallback = text ? text.slice(0, 180) : "resposta vazia";
          throw new Error(
            data?.message || data?.error || `Falha ao iniciar login Google (${response.status}): ${fallback}`,
          );
        }

        window.location.href = data.auth_url;
      } catch (error) {
        errorMessage.value = error.message;
        statusMessage.value = "";
      } finally {
        loadingLogin.value = false;
      }
    }

    async function exchangeGoogleCode(code) {
      if (hasCodeBeenExchanged(code)) {
        return;
      }

      loadingExchange.value = true;
      errorMessage.value = "";
      statusMessage.value = "Validando o retorno do Google e abrindo sua sessão...";

      try {
        const response = await fetch(`${gatewayBase}/auth-api/google/exchange`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            code,
            redirectUri: callbackUrl,
          }),
        });

        const text = await response.text();
        const data = parseJsonSafe(text);
        if (!response.ok || !data.access_token) {
          const detailedMessage =
            data?.message ||
            [data?.details?.error, data?.details?.error_description].filter(Boolean).join(" - ") ||
            data?.error ||
            text?.slice(0, 180);
          throw new Error(detailedMessage || `Falha ao trocar o código por token (${response.status})`);
        }

        persistSession(data.access_token, data.user);
        markCodeAsExchanged(code);
        window.history.replaceState({}, document.title, callbackPath);
        statusMessage.value = "Sessão criada. Redirecionando para sua área autenticada...";
        window.setTimeout(() => {
          window.location.replace("/");
        }, 500);
      } catch (error) {
        errorMessage.value = error.message;
        statusMessage.value = "";
      } finally {
        loadingExchange.value = false;
      }
    }

    async function fetchProtectedHealth() {
      loadingProtected.value = true;
      errorMessage.value = "";
      protectedStatus.value = "";
      protectedResult.value = "";

      if (!token.value) {
        loadingProtected.value = false;
        errorMessage.value = "Informe um token JWT para testar a rota protegida.";
        protectedResult.value = "Sem token para enviar no header Authorization.";
        return;
      }

      try {
        const response = await fetch(`${gatewayBase}/health-api/health`, {
          headers: {
            Authorization: `Bearer ${token.value}`,
          },
        });

        const text = await response.text();
        protectedStatus.value = `${response.status} ${response.statusText}`;

        try {
          const jsonData = JSON.parse(text);
          protectedResult.value = JSON.stringify(jsonData, null, 2);
        } catch {
          protectedResult.value = text || "(resposta sem corpo)";
        }

        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            statusMessage.value =
              "Token inválido/expirado para rota protegida. Faça login novamente para obter um novo token.";
          }
          throw new Error(`Falha ao chamar rota protegida: ${response.status}`);
        }

        statusMessage.value = "Rota protegida validada com sucesso.";
      } catch (error) {
        errorMessage.value = error.message;
        if (!protectedResult.value) {
          protectedResult.value = "Não foi possível obter resposta da rota protegida.";
        }
      } finally {
        loadingProtected.value = false;
      }
    }

    function logout() {
      clearSession();
      tokenInput.value = "";
      statusMessage.value = "Sessão encerrada.";
      errorMessage.value = "";
      if (isCallback) {
        window.location.replace("/");
      }
    }

    function saveManualToken() {
      const raw = tokenInput.value.trim();
      if (!raw) {
        errorMessage.value = "Cole um token JWT válido antes de salvar.";
        return;
      }

      token.value = raw;
      window.localStorage.setItem(storageKeys.token, raw);

      if (!user.value) {
        const localUser = {
          name: "Sessão local",
          email: "manual@fusca.local",
          id: "manual-token",
        };
        user.value = localUser;
        window.localStorage.setItem(storageKeys.user, JSON.stringify(localUser));
      }

      errorMessage.value = "";
      statusMessage.value = "Token manual salvo. Agora você pode testar a rota protegida.";
    }

    function openCallbackPage() {
      window.location.assign(callbackUrl);
    }

    onMounted(() => {
      const params = new URLSearchParams(window.location.search);
      const authError = params.get("error");
      const authCode = params.get("code");

      if (authError) {
        errorMessage.value = `Google retornou erro: ${authError}`;
        return;
      }

      if (isCallback && authCode) {
        exchangeGoogleCode(authCode);
      }
    });

    return {
      callbackUrl,
      errorMessage,
      fetchProtectedHealth,
      isCallback,
      isLoggedIn,
      loadingExchange,
      loadingLogin,
      loadingProtected,
      logout,
      openCallbackPage,
      protectedResult,
      protectedStatus,
      saveManualToken,
      startGoogleLogin,
      statusMessage,
      token,
      tokenInput,
      user,
    };
  },
  template: `
    <div class="shell">
      <section class="hero">
        <article class="panel panel-main">
          <span class="eyebrow">Fusca Azul • Vue + Kong OSS</span>
          <h1>Login Google na entrada, JWT próprio nas rotas protegidas.</h1>
          <p class="lead">
            A autenticação acontece no Google, o auth-api converte o retorno em um token da aplicação,
            e o Kong valida esse JWT antes de deixar passar para os microserviços.
          </p>
          <div class="actions" v-if="!isLoggedIn && !isCallback">
            <button class="button button-primary" @click="startGoogleLogin" :disabled="loadingLogin">
              {{ loadingLogin ? 'Abrindo login Google...' : 'Entrar com Google' }}
            </button>
            <button class="button button-secondary" @click="openCallbackPage">
              Ver rota de callback
            </button>
          </div>
          <div class="actions" v-else-if="isLoggedIn">
            <button class="button button-primary" @click="fetchProtectedHealth" :disabled="loadingProtected">
              {{ loadingProtected ? 'Consultando rota protegida...' : 'Testar rota protegida' }}
            </button>
            <button class="button button-secondary" @click="logout">Sair</button>
          </div>
          <div class="stats">
            <div class="stat">
              <strong>Google</strong>
              <span>Autentica o usuário final</span>
            </div>
            <div class="stat">
              <strong>Auth API</strong>
              <span>Troca o code e emite JWT da aplicação</span>
            </div>
            <div class="stat">
              <strong>Kong OSS</strong>
              <span>Valida o JWT antes de encaminhar</span>
            </div>
          </div>
        </article>

        <aside class="panel panel-side">
          <h2>Fluxo da sessão</h2>
          <div class="pill-grid">
            <span class="pill">1. Google Sign-In</span>
            <span class="pill">2. Callback na SPA</span>
            <span class="pill">3. /auth-api/google/exchange</span>
            <span class="pill">4. Bearer token no Kong</span>
          </div>
          <div class="status" v-if="!isCallback" style="display: grid; gap: 10px; margin-top: 12px;">
            <strong>Teste sem Google (token manual)</strong>
            <textarea
              v-model="tokenInput"
              rows="3"
              placeholder="Cole aqui o JWT para teste"
              style="width: 100%; border-radius: 12px; border: 1px solid var(--line); padding: 10px; font-family: monospace; resize: vertical;"
            ></textarea>
            <div class="actions" style="margin-top: 0;">
              <button class="button button-secondary" @click="saveManualToken">Salvar token manual</button>
              <button class="button button-primary" @click="fetchProtectedHealth" :disabled="loadingProtected || !tokenInput.trim()">
                {{ loadingProtected ? 'Consultando...' : 'Testar com token manual' }}
              </button>
            </div>
          </div>
          <div v-if="statusMessage" class="status">
            <strong>Status atual</strong>
            <p>{{ statusMessage }}</p>
          </div>
          <div v-if="errorMessage" class="status status-error">
            <strong>Falha</strong>
            <p>{{ errorMessage }}</p>
          </div>
          <div v-if="isCallback" class="status callback-note">
            <strong>Callback ativa</strong>
            <p>Se o Google redirecionou corretamente, esta tela processa o code e volta para a área autenticada.</p>
          </div>
        </aside>
      </section>

      <section class="dashboard" v-if="isLoggedIn">
        <article class="panel panel-main">
          <h2>Área autenticada</h2>
          <p>
            Seu token já está salvo no navegador. Use o botão acima para validar a rota protegida do health-api via Kong.
          </p>
          <div v-if="loadingProtected" class="result" style="margin-top: 18px;">
            <strong>Carregando resposta...</strong>
            <p style="color: var(--muted);">Consultando a rota protegida do health-api...</p>
          </div>
          <div class="result" style="margin-top: 18px;" v-else-if="protectedResult">
            <strong>✓ Resposta da rota protegida (health-api)</strong>
            <p style="font-size: 0.9rem; color: var(--muted); margin: 8px 0 12px;">
              Status: {{ protectedStatus || 'desconhecido' }}
            </p>
            <pre>{{ protectedResult }}</pre>
          </div>
          <div class="result" style="margin-top: 18px;" v-else>
            <strong>Pronto para testar</strong>
            <p>Ao chamar a rota protegida, a resposta do health-api aparece aqui.</p>
          </div>
        </article>

        <aside class="panel panel-side">
          <div class="user-card">
            <img v-if="user && user.picture" :src="user.picture" alt="Foto do usuário" />
            <strong>{{ user?.name || user?.email || 'Usuário autenticado' }}</strong>
            <div class="muted-list">
              <span><strong>Email:</strong> {{ user?.email || 'não informado' }}</span>
              <span><strong>Subject:</strong> {{ user?.id || 'não informado' }}</span>
              <span><strong>Token:</strong> {{ token.slice(0, 36) }}...</span>
            </div>
          </div>
        </aside>
      </section>
    </div>
  `,
}).mount("#app");
