# Diagrama de Entidade Relacionamento (DER)

Abaixo está o modelo de dados para o monolito do Fusca Azul.

```mermaid
erDiagram
    USUARIOS {
        int id PK
        string nome
        string email
        string senha_hash
        int pontos_ranking
        timestamp data_cadastro
    }

    FOTOS {
        int id PK
        int usuario_id FK
        string url_foto
        decimal latitude
        decimal longitude
        string status
        timestamp data_postagem
    }

    SOQUINHOS {
        int id PK
        int foto_id FK "UNIQUE"
        int usuario_id FK
        string status
        timestamp data_registro
    }

    CONTESTACOES {
        int id PK
        int soquinho_id FK
        int usuario_id FK
        string motivo
        string status
        timestamp data_contestacao
    }

    DENUNCIAS {
        int id PK
        int foto_id FK
        int usuario_id_denunciante FK
        string status
        timestamp data_denuncia
    }

    VOTOS_MODERACAO {
        int id PK
        int denuncia_id FK
        int usuario_id_moderador FK
        string voto
        timestamp data_voto
    }

    USUARIOS ||--o{ FOTOS : "posta"
    USUARIOS ||--o{ SOQUINHOS : "registra"
    FOTOS ||--o| SOQUINHOS : "recebe (máx 1)"
    SOQUINHOS ||--o{ CONTESTACOES : "sofre"
    USUARIOS ||--o{ CONTESTACOES : "abre"
    FOTOS ||--o{ DENUNCIAS : "recebe"
    USUARIOS ||--o{ DENUNCIAS : "reporta"
    DENUNCIAS ||--|{ VOTOS_MODERACAO : "gera"
    USUARIOS ||--o{ VOTOS_MODERACAO : "avalia"
```

Agora temos uma visão de microsserviços

```mermaid

graph TD
    Client[Cliente / Frontend] -->|1. Pede Relatório de Socos| ReportSvc[Serviço de Relatórios / API Gateway]
    
    subgraph Microsserviço de Usuários
        UserSvc[User Service] --->|Leitura| UserDB[(User DB)]
    end

    subgraph Microsserviço de Fotos
        FotoSvc[Foto Service] --->|Leitura| FotoDB[(Foto DB)]
    end

    subgraph Microsserviço de Socos
        SocoSvc[Soco Service] --->|Leitura| SocoDB[(Soco DB)]
    end

    ReportSvc -->|2. Busca quem deu o soco| SocoSvc
    ReportSvc -->|3. Busca os dados do Usuário| UserSvc
    ReportSvc -->|4. Busca a URL e data da Foto| FotoSvc

    style UserDB fill:#f9f,stroke:#333,stroke-width:2px
    style FotoDB fill:#bbf,stroke:#333,stroke-width:2px
    style SocoDB fill:#fbf,stroke:#333,stroke-width:2px
```

Como fica com um banco de relatórios

```mermaid
graph LR
    subgraph Microsserviços de Escrita
        A[User Service] -->|Evento: UsuarioCadastrado| MQ[RabbitMQ]
        B[Foto Service] -->|Evento: FotoPostada| MQ
        C[Soco Service] -->|Evento: SocoRegistrado| MQ
    end

    MQ -->|Consome Eventos| R_Svc[Serviço de Relatórios]
    R_Svc -->|Salva / Atualiza| R_DB[(Banco de Relatórios)]

    subgraph Estrutura do Banco de Relatórios
        R_DB --> T1[tabela_relatorio_socos]
    end