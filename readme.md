# Fusca Azul — Requisitos Básicos

## Contexto
O **Fusca Azul** é um aplicativo de estudo para aulas de microserviços, voltado a alunos de Ciência da Computação da oitava fase.

## Requisitos Funcionais
1. **Cadastro de usuários**
	- O sistema deve permitir o cadastro de novos usuários.

2. **Autenticação**
	- O sistema deve permitir login e controle de sessão de usuários autenticados.

3. **Postagem de foto com geolocalização**
	- O usuário deve poder postar foto de um fusca azul.
	- A postagem deve incluir geolocalização.

4. **Soquinho para o primeiro que visualizar**
	- Apenas a primeira pessoa que visualizar a foto pode registrar um soquinho.
	- Demais usuários não podem registrar soquinho para a mesma foto.

5. **Ranking de usuários**
	- O sistema deve manter ranking com usuários que possuem mais soquinhos.

6. **Contestação de soquinho**
	- O sistema deve permitir contestar soquinhos registrados.

7. **Denúncia de foto inválida**
	- O sistema deve permitir denúncia de foto quando não for de um fusca azul.

8. **Moderação por usuários com mais pontos**
	- Usuários com mais pontos podem receber denúncias para análise.
	- Ao menos 3 usuários devem ser notificados para avaliar a denúncia.
	- A redução de pontos só ocorre quando houver maioria de votos aceitando a denúncia.

## Requisitos Não Funcionais
1. **Arquitetura de microserviços**
	- O sistema deve ser estruturado em microserviços.

2. **Autenticação baseada em JWT**
	- O mecanismo de autenticação deve usar JWT.

3. **Separação entre backend e frontend**
	- Backend e frontend devem ser implementados de forma separada.

# Arquitetura do Fusca Azul

![Arquitetura do Fusca Azul](./arquitetura-fusca-azul.svg)

O diagrama apresenta uma arquitetura em camadas: clientes Web/Mobile consomem a SPA, que acessa o backend via API Gateway (Kong). No backend, cada capacidade de negocio (autenticacao, usuarios, fotos, soquinho, contestacao, denuncia e moderacao) fica em um microservico independente, com comunicacao sincrona para operacoes de consulta/comando e assincrona por eventos para fluxos de denuncia, revisao e atualizacao de ranking. A persistencia e desacoplada em uma camada de infraestrutura com Postgres, Redis, RabbitMQ e SeaweedFS (S3 compativel), permitindo evolucao gradual para isolamento de dados por microservico.

## Como subir todo o conjunto

### Pré-requisitos
- Docker 24+ instalado
- Docker Compose v2 instalado (`docker compose version`)
- Portas livres na máquina: 5173, 8000, 8001, 5432, 5672, 6379, 8333, 8888, 9333, 15672, 27017

### 1. Validar a configuração
```bash
docker compose config
```

### 2. Subir toda a infraestrutura
```bash
docker compose up -d
```

### 3. Verificar status dos serviços
```bash
docker compose ps
```

### 4. Acessar os serviços
- SPA Frontend: http://localhost:5173
- Kong (proxy): http://localhost:8000
- Kong Admin API: http://localhost:8001
- Health API (direto): http://localhost:3001/health
- Health API (via Kong): http://localhost:8000/health-api/health
- Location API (direto): http://localhost:3003/health
- Location API (via Kong): http://localhost:8000/location-api/health
- Location API Swagger UI (direto): http://localhost:3003/docs
- Location API Swagger UI (via Kong): http://localhost:8000/location-api/docs
- RabbitMQ Management: http://localhost:15672
- Postgres: localhost:5432
- MongoDB: localhost:27017
- Redis: localhost:6379
- SeaweedFS S3 API: http://localhost:8333
- SeaweedFS UI/Filer: http://localhost:8888
- SeaweedFS Master status: http://localhost:9333/cluster/status

### 5. Credenciais padrão do ambiente (desenvolvimento)
- Postgres: usuário `fusca`, senha `fusca123`, banco `fusca_azul`
- MongoDB: usuário root `fusca`, senha `fusca123`, auth db `admin`
- RabbitMQ: usuário `fusca`, senha `fusca123`
- SeaweedFS S3: access key `fusca`, secret key `fusca123`

### 6. Ver logs em tempo real
```bash
docker compose logs -f
```

### 7. Parar toda a infraestrutura
```bash
docker compose down
```

### 8. Parar e remover volumes (reset completo)
```bash
docker compose down -v
```

## Configurar login Google com Kong OSS (JWT)

Sem Kong Enterprise, o fluxo recomendado e:
1. Usuario autentica no Google.
2. `auth-api` troca o `code` do Google e emite um JWT proprio da aplicacao.
3. Kong valida esse JWT com o plugin `jwt` nas rotas protegidas.

### 1. Defina as variaveis de ambiente
Use o arquivo `.env.google.example` como base e crie um `.env.google` com os valores reais.

### 2. Suba os servicos relevantes
```bash
docker compose up -d --build auth-api api-gateway health-api
```

### 3. Abra a SPA
- Acesse `http://localhost:5173`
- Clique em `Entrar com Google`
- A SPA chama `auth-api/google/url`, redireciona para o Google e processa automaticamente o retorno em `http://localhost:5173/auth/callback`

### 4. Gere a URL de login Google manualmente
```bash
curl -s "http://localhost:8000/auth-api/google/url?redirect_uri=http://localhost:5173/auth/callback"
```

### 5. Troque o `code` por JWT da aplicacao
Depois de autenticar no Google, pegue o `code` retornado no redirect e execute:
```bash
curl -s -X POST http://localhost:8000/auth-api/google/exchange \
	-H "Content-Type: application/json" \
	-d '{
		"code": "SEU_GOOGLE_AUTH_CODE",
		"redirectUri": "http://localhost:5173/auth/callback"
	}'
```

### 6. Use o JWT nas rotas protegidas do Kong
```bash
curl -i http://localhost:8000/health-api/health \
	-H "Authorization: Bearer SEU_APP_ACCESS_TOKEN"
```

Teste sem token (deve retornar `401`):
```bash
curl -i http://localhost:8000/health-api/health
```

Observacoes:
- O plugin `openid-connect` do Kong e Enterprise.
- No Kong OSS (DB-less), o segredo JWT usado pelo `auth-api` (`APP_JWT_SECRET`) deve ser igual ao `secret` configurado em `kong/kong.yml` no `jwt_secrets`.

## API de localizacao de fuscas (MongoDB)

Servico: `location-api`

Campos obrigatorios:
- `geolocation`: GeoJSON Point no formato OpenStreetMap
- `locatedBy`: usuario que localizou

Exemplo de `geolocation`:
```json
{
	"type": "Point",
	"coordinates": [-48.548, -27.596]
}
```

### Criar localizacao
```bash
curl -s -X POST http://localhost:8000/location-api/locations \
	-H "Content-Type: application/json" \
	-d '{
		"geolocation": { "type": "Point", "coordinates": [-48.548, -27.596] },
		"locatedBy": "joao"
	}'
```

### Listar localizacoes
```bash
curl -s http://localhost:8000/location-api/locations
```

Filtrar por usuario:
```bash
curl -s "http://localhost:8000/location-api/locations?usuario=joao"
```

### Buscar por ID
```bash
curl -s http://localhost:8000/location-api/locations/ID_DA_LOCALIZACAO
```

### Atualizar por ID
```bash
curl -s -X PUT http://localhost:8000/location-api/locations/ID_DA_LOCALIZACAO \
	-H "Content-Type: application/json" \
	-d '{
		"geolocation": { "type": "Point", "coordinates": [-48.55, -27.59] },
		"locatedBy": "maria"
	}'
```

### Excluir por ID
```bash
curl -i -X DELETE http://localhost:8000/location-api/locations/ID_DA_LOCALIZACAO
```




