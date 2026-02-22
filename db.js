/**
 * ============================================================
 * BLUE SHIELD PRO - DATABASE MODULE
 * ============================================================
 * Arquitetura profissional com:
 * - Normalização de tabelas (3FN)
 * - Índices otimizados para consultas frequentes
 * - Soft delete (auditoria completa)
 * - Transações ACID
 * - Logs de auditoria
 * ============================================================
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

// ============================================================
// CONFIGURAÇÃO
// ============================================================
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const DB_OPTIONS = {
    verbose: process.env.NODE_ENV === 'development' ? console.log : null,
    fileMustExist: false,
};

// ============================================================
// CONEXÃO COM O BANCO
// ============================================================
let db;

try {
    db = new Database(DB_PATH, DB_OPTIONS);
    db.pragma('journal_mode = WAL'); // Write-Ahead Logging para melhor performance
    db.pragma('foreign_keys = ON');  // Habilitar chaves estrangeiras
    db.pragma('synchronous = NORMAL'); // Balance entre segurança e performance
    console.log('[DB] ✅ Conexão estabelecida com SQLite');
} catch (error) {
    console.error('[DB] ❌ Erro ao conectar:', error.message);
    process.exit(1);
}

// ============================================================
// SCHEMA - CRIAÇÃO DAS TABELAS
// ============================================================

const SCHEMA = {
    // Tabela de configurações do sistema
    config: `
        CREATE TABLE IF NOT EXISTS config (
            chave TEXT PRIMARY KEY,
            valor TEXT NOT NULL,
            descricao TEXT,
            atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `,

    // Tabela de produtos
    produtos: `
        CREATE TABLE IF NOT EXISTS produtos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sku TEXT UNIQUE NOT NULL,
            nome TEXT NOT NULL,
            descricao TEXT,
            preco_unitario REAL NOT NULL CHECK (preco_unitario >= 0),
            estoque INTEGER DEFAULT 0 CHECK (estoque >= 0),
            ativo INTEGER DEFAULT 1 CHECK (ativo IN (0, 1)),
            imagem_url TEXT,
            especificacoes TEXT, -- JSON com especificações técnicas
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            deletado_em DATETIME -- Soft delete
        )
    `,

    // Tabela de usuários (clientes)
    usuarios: `
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            uuid TEXT UNIQUE NOT NULL, -- UUID público para referências externas
            nome TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            cpf TEXT UNIQUE NOT NULL,
            senha_hash TEXT NOT NULL,
            telefone TEXT,
            data_nascimento DATE,
            genero TEXT CHECK (genero IN ('M', 'F', 'O', 'N')),
            
            -- Status da conta
            status TEXT DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo', 'bloqueado', 'pendente')),
            email_verificado INTEGER DEFAULT 0 CHECK (email_verificado IN (0, 1)),
            
            -- Campos de auditoria
            ultimo_login DATETIME,
            tentativas_login INTEGER DEFAULT 0,
            
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            deletado_em DATETIME -- Soft delete
        )
    `,

    // Tabela de endereços (normalização - um usuário pode ter vários endereços)
    enderecos: `
        CREATE TABLE IF NOT EXISTS enderecos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            
            -- Dados do endereço
            cep TEXT NOT NULL,
            logradouro TEXT NOT NULL,
            numero TEXT NOT NULL,
            complemento TEXT,
            bairro TEXT NOT NULL,
            cidade TEXT NOT NULL,
            estado TEXT NOT NULL,
            pais TEXT DEFAULT 'BR',
            
            -- Tipo e preferência
            tipo TEXT DEFAULT 'entrega' CHECK (tipo IN ('entrega', 'cobranca', 'ambos')),
            padrao INTEGER DEFAULT 0 CHECK (padrao IN (0, 1)),
            
            -- Validação
            validado INTEGER DEFAULT 0 CHECK (validado IN (0, 1)),
            
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            deletado_em DATETIME,
            
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
        )
    `,

    // Tabela de pedidos
    pedidos: `
        CREATE TABLE IF NOT EXISTS pedidos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            numero_pedido TEXT UNIQUE NOT NULL, -- Número legível (ex: BSP-20250222-0001)
            
            -- Relacionamentos
            usuario_id INTEGER NOT NULL,
            endereco_id INTEGER NOT NULL,
            
            -- Valores
            subtotal REAL NOT NULL CHECK (subtotal >= 0),
            frete REAL NOT NULL DEFAULT 0 CHECK (frete >= 0),
            desconto REAL NOT NULL DEFAULT 0 CHECK (desconto >= 0),
            total REAL NOT NULL CHECK (total >= 0),
            
            -- Status do pedido
            status TEXT DEFAULT 'pendente' CHECK (status IN (
                'pendente', 'aguardando_pagamento', 'pago', 'processando', 
                'enviado', 'entregue', 'cancelado', 'reembolsado'
            )),
            
            -- Pagamento
            metodo_pagamento TEXT CHECK (metodo_pagamento IN (
                'cartao_credito', 'cartao_debito', 'boleto', 'pix', 'transferencia'
            )),
            pagamento_status TEXT DEFAULT 'pendente' CHECK (pagamento_status IN (
                'pendente', 'aprovado', 'recusado', 'estornado'
            )),
            pagamento_data DATETIME,
            pagamento_transacao_id TEXT, -- ID da transação no gateway
            
            -- Envio
            codigo_rastreio TEXT,
            envio_data DATETIME,
            entrega_prevista DATE,
            entrega_realizada DATETIME,
            
            -- Observações
            observacoes_cliente TEXT,
            observacoes_internas TEXT,
            
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id),
            FOREIGN KEY (endereco_id) REFERENCES enderecos(id)
        )
    `,

    // Tabela de itens do pedido
    pedido_itens: `
        CREATE TABLE IF NOT EXISTS pedido_itens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL,
            produto_id INTEGER NOT NULL,
            
            -- Dados do item (snapshot no momento da compra)
            sku TEXT NOT NULL,
            nome TEXT NOT NULL,
            quantidade INTEGER NOT NULL CHECK (quantidade > 0),
            preco_unitario REAL NOT NULL CHECK (preco_unitario >= 0),
            subtotal REAL NOT NULL CHECK (subtotal >= 0),
            
            -- Especificações
            variacao TEXT, -- cor, tamanho, etc
            
            FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
            FOREIGN KEY (produto_id) REFERENCES produtos(id)
        )
    `,

    // Tabela de histórico de status dos pedidos
    pedido_historico: `
        CREATE TABLE IF NOT EXISTS pedido_historico (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER NOT NULL,
            status_anterior TEXT,
            status_novo TEXT NOT NULL,
            observacao TEXT,
            usuario_responsavel_id INTEGER, -- NULL se for sistema
            ip_address TEXT,
            user_agent TEXT,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            
            FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE
        )
    `,

    // Tabela de logs de auditoria
    audit_logs: `
        CREATE TABLE IF NOT EXISTS audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            
            -- Identificação
            uuid TEXT UNIQUE NOT NULL,
            tabela TEXT NOT NULL,
            registro_id INTEGER,
            acao TEXT NOT NULL CHECK (acao IN ('INSERT', 'UPDATE', 'DELETE', 'SELECT', 'LOGIN', 'LOGOUT', 'ERROR')),
            
            -- Dados
            dados_anteriores TEXT, -- JSON
            dados_novos TEXT, -- JSON
            
            -- Contexto
            usuario_id INTEGER,
            ip_address TEXT,
            user_agent TEXT,
            endpoint TEXT,
            metodo_http TEXT,
            
            -- Timestamp
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
        )
    `,

    // Tabela de sessões (para controle de login)
    sessoes: `
        CREATE TABLE IF NOT EXISTS sessoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            refresh_token TEXT UNIQUE,
            
            -- Dispositivo/Contexto
            ip_address TEXT,
            user_agent TEXT,
            dispositivo TEXT,
            
            -- Validade
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            expira_em DATETIME NOT NULL,
            ultima_atividade DATETIME DEFAULT CURRENT_TIMESTAMP,
            
            -- Status
            ativo INTEGER DEFAULT 1 CHECK (ativo IN (0, 1)),
            encerrado_em DATETIME,
            motivo_encerramento TEXT CHECK (motivo_encerramento IN ('logout', 'expirado', 'revogado', 'troca_senha')),
            
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
        )
    `,

    // Tabela de tokens de recuperação de senha
    password_resets: `
        CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expira_em DATETIME NOT NULL,
            utilizado INTEGER DEFAULT 0 CHECK (utilizado IN (0, 1)),
            utilizado_em DATETIME,
            ip_address TEXT,
            criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
            
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
        )
    `
};

// ============================================================
// ÍNDICES PARA PERFORMANCE
// ============================================================

const INDEXES = [
    // Usuários
    `CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email) WHERE deletado_em IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_usuarios_cpf ON usuarios(cpf) WHERE deletado_em IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_usuarios_status ON usuarios(status) WHERE deletado_em IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_usuarios_criado ON usuarios(criado_em)`,
    
    // Endereços
    `CREATE INDEX IF NOT EXISTS idx_enderecos_usuario ON enderecos(usuario_id) WHERE deletado_em IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_enderecos_cep ON enderecos(cep)`,
    `CREATE INDEX IF NOT EXISTS idx_enderecos_padrao ON enderecos(usuario_id, padrao) WHERE padrao = 1`,
    
    // Pedidos
    `CREATE INDEX IF NOT EXISTS idx_pedidos_usuario ON pedidos(usuario_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_numero ON pedidos(numero_pedido)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_criado ON pedidos(criado_em)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_status_data ON pedidos(status, criado_em)`,
    
    // Itens do pedido
    `CREATE INDEX IF NOT EXISTS idx_pedido_itens_pedido ON pedido_itens(pedido_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pedido_itens_produto ON pedido_itens(produto_id)`,
    
    // Histórico
    `CREATE INDEX IF NOT EXISTS idx_pedido_historico_pedido ON pedido_historico(pedido_id, criado_em)`,
    
    // Logs de auditoria
    `CREATE INDEX IF NOT EXISTS idx_audit_tabela ON audit_logs(tabela, registro_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_usuario ON audit_logs(usuario_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_criado ON audit_logs(criado_em)`,
    
    // Sessões
    `CREATE INDEX IF NOT EXISTS idx_sessoes_token ON sessoes(token)`,
    `CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id, ativo)`,
    `CREATE INDEX IF NOT EXISTS idx_sessoes_expira ON sessoes(expira_em) WHERE ativo = 1`
];

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

/**
 * Gera um UUID v4
 */
function generateUUID() {
    return crypto.randomUUID();
}

/**
 * Gera número de pedido único
 * Formato: BSP-YYYYMMDD-XXXX
 */
function generateOrderNumber() {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    const random = Math.floor(1000 + Math.random() * 9000);
    return `BSP-${dateStr}-${random}`;
}

/**
 * Atualiza o timestamp de atualização
 */
function updateTimestamp(table, id) {
    const stmt = db.prepare(`UPDATE ${table} SET atualizado_em = CURRENT_TIMESTAMP WHERE id = ?`);
    stmt.run(id);
}

// ============================================================
// INICIALIZAÇÃO DO BANCO
// ============================================================

function initializeDatabase() {
    console.log('[DB] 🚀 Inicializando schema...');
    
    try {
        // Criar tabelas
        Object.entries(SCHEMA).forEach(([name, sql]) => {
            db.exec(sql);
            console.log(`[DB]   ✓ Tabela: ${name}`);
        });
        
        // Criar índices
        INDEXES.forEach(sql => {
            db.exec(sql);
        });
        console.log(`[DB]   ✓ ${INDEXES.length} índices criados`);
        
        // Inserir produto padrão se não existir
        const produtoPadrao = db.prepare('SELECT id FROM produtos WHERE sku = ?').get('BLUESHIELD-PRO-001');
        if (!produtoPadrao) {
            const insertProduto = db.prepare(`
                INSERT INTO produtos (sku, nome, descricao, preco_unitario, estoque, especificacoes)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            insertProduto.run(
                'BLUESHIELD-PRO-001',
                'BlueShield Pro',
                'Óculos bloqueador de luz azul para profissionais de alta performance',
                299.00,
                1000,
                JSON.stringify({
                    peso: '22g',
                    material_armacao: 'TR90',
                    material_lente: 'Policarbonato',
                    protecao: 'UV400',
                    largura: '143mm',
                    altura_lente: '47mm',
                    ponte_nasal: '48mm'
                })
            );
            console.log('[DB]   ✓ Produto padrão inserido');
        }
        
        // Inserir configurações padrão
        const configs = [
            ['preco_default', '299.00', 'Preço padrão do produto'],
            ['frete_gratis', 'true', 'Frete grátis ativado'],
            ['estoque_minimo', '10', 'Alerta de estoque baixo'],
            ['versao_db', '1.0.0', 'Versão do schema do banco']
        ];
        
        const insertConfig = db.prepare('INSERT OR IGNORE INTO config (chave, valor, descricao) VALUES (?, ?, ?)');
        configs.forEach(([chave, valor, descricao]) => {
            insertConfig.run(chave, valor, descricao);
        });
        
        console.log('[DB] ✅ Banco de dados inicializado com sucesso!\n');
        
    } catch (error) {
        console.error('[DB] ❌ Erro na inicialização:', error.message);
        throw error;
    }
}

// ============================================================
// CLASSE DE REPOSITÓRIO (Métodos de Acesso a Dados)
// ============================================================

class Repository {
    constructor(database) {
        this.db = database;
    }
    
    // ==================== USUÁRIOS ====================
    
    createUser(dados) {
        const { nome, email, cpf, senha_hash, telefone } = dados;
        const uuid = generateUUID();
        
        const stmt = this.db.prepare(`
            INSERT INTO usuarios (uuid, nome, email, cpf, senha_hash, telefone)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(uuid, nome, email, cpf, senha_hash, telefone);
        return { id: result.lastInsertRowid, uuid };
    }
    
    getUserByEmail(email, incluirDeletados = false) {
        let sql = 'SELECT * FROM usuarios WHERE email = ?';
        if (!incluirDeletados) sql += ' AND deletado_em IS NULL';
        return this.db.prepare(sql).get(email);
    }
    
    getUserByCPF(cpf, incluirDeletados = false) {
        let sql = 'SELECT * FROM usuarios WHERE cpf = ?';
        if (!incluirDeletados) sql += ' AND deletado_em IS NULL';
        return this.db.prepare(sql).get(cpf);
    }
    
    getUserById(id, incluirDeletados = false) {
        let sql = 'SELECT * FROM usuarios WHERE id = ?';
        if (!incluirDeletados) sql += ' AND deletado_em IS NULL';
        return this.db.prepare(sql).get(id);
    }
    
    updateUserLogin(userId) {
        const stmt = this.db.prepare(`
            UPDATE usuarios 
            SET ultimo_login = CURRENT_TIMESTAMP, tentativas_login = 0
            WHERE id = ?
        `);
        stmt.run(userId);
    }
    
    incrementLoginAttempts(userId) {
        const stmt = this.db.prepare(`
            UPDATE usuarios SET tentativas_login = tentativas_login + 1 WHERE id = ?
        `);
        stmt.run(userId);
    }
    
    softDeleteUser(userId) {
        const stmt = this.db.prepare(`
            UPDATE usuarios SET deletado_em = CURRENT_TIMESTAMP, status = 'inativo' WHERE id = ?
        `);
        return stmt.run(userId);
    }
    
    // ==================== ENDEREÇOS ====================
    
    createAddress(dados) {
        const { usuario_id, cep, logradouro, numero, complemento, bairro, cidade, estado, tipo = 'entrega', padrao = 0 } = dados;
        
        // Se for endereço padrão, remove o padrão dos outros
        if (padrao) {
            this.db.prepare('UPDATE enderecos SET padrao = 0 WHERE usuario_id = ?').run(usuario_id);
        }
        
        const stmt = this.db.prepare(`
            INSERT INTO enderecos (usuario_id, cep, logradouro, numero, complemento, bairro, cidade, estado, tipo, padrao)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(usuario_id, cep, logradouro, numero, complemento, bairro, cidade, estado, tipo, padrao);
        return { id: result.lastInsertRowid };
    }
    
    getAddressesByUser(userId) {
        return this.db.prepare(`
            SELECT * FROM enderecos 
            WHERE usuario_id = ? AND deletado_em IS NULL 
            ORDER BY padrao DESC, criado_em DESC
        `).all(userId);
    }
    
    getDefaultAddress(userId) {
        return this.db.prepare(`
            SELECT * FROM enderecos 
            WHERE usuario_id = ? AND padrao = 1 AND deletado_em IS NULL
        `).get(userId);
    }
    
    // ==================== PEDIDOS ====================
    
    createOrder(dados) {
        const { usuario_id, endereco_id, subtotal, frete = 0, desconto = 0, total, metodo_pagamento, observacoes_cliente } = dados;
        const numero_pedido = generateOrderNumber();
        
        const stmt = this.db.prepare(`
            INSERT INTO pedidos (numero_pedido, usuario_id, endereco_id, subtotal, frete, desconto, total, metodo_pagamento, observacoes_cliente)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(numero_pedido, usuario_id, endereco_id, subtotal, frete, desconto, total, metodo_pagamento, observacoes_cliente);
        return { id: result.lastInsertRowid, numero_pedido };
    }
    
    addOrderItem(dados) {
        const { pedido_id, produto_id, sku, nome, quantidade, preco_unitario, variacao } = dados;
        const subtotal = quantidade * preco_unitario;
        
        const stmt = this.db.prepare(`
            INSERT INTO pedido_itens (pedido_id, produto_id, sku, nome, quantidade, preco_unitario, subtotal, variacao)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        return stmt.run(pedido_id, produto_id, sku, nome, quantidade, preco_unitario, subtotal, variacao);
    }
    
    getOrderById(orderId) {
        return this.db.prepare(`
            SELECT p.*, u.nome as cliente_nome, u.email as cliente_email, u.telefone as cliente_telefone
            FROM pedidos p
            JOIN usuarios u ON p.usuario_id = u.id
            WHERE p.id = ?
        `).get(orderId);
    }
    
    getOrderItems(orderId) {
        return this.db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ?').all(orderId);
    }
    
    updateOrderStatus(orderId, novoStatus, observacao = null, usuarioResponsavelId = null) {
        const pedido = this.getOrderById(orderId);
        if (!pedido) throw new Error('Pedido não encontrado');
        
        const statusAnterior = pedido.status;
        
        // Atualiza status
        const stmt = this.db.prepare(`
            UPDATE pedidos SET status = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?
        `);
        stmt.run(novoStatus, orderId);
        
        // Registra no histórico
        const histStmt = this.db.prepare(`
            INSERT INTO pedido_historico (pedido_id, status_anterior, status_novo, observacao, usuario_responsavel_id)
            VALUES (?, ?, ?, ?, ?)
        `);
        histStmt.run(orderId, statusAnterior, novoStatus, observacao, usuarioResponsavelId);
        
        return { statusAnterior, novoStatus };
    }
    
    // ==================== PRODUTOS ====================
    
    getProductBySku(sku) {
        return this.db.prepare('SELECT * FROM produtos WHERE sku = ? AND deletado_em IS NULL AND ativo = 1').get(sku);
    }
    
    updateStock(productId, quantidade) {
        const stmt = this.db.prepare(`
            UPDATE produtos SET estoque = estoque - ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?
        `);
        return stmt.run(quantidade, productId);
    }
    
    // ==================== AUDITORIA ====================
    
    logAudit(dados) {
        const { tabela, registro_id, acao, dados_anteriores, dados_novos, usuario_id, ip_address, user_agent, endpoint, metodo_http } = dados;
        const uuid = generateUUID();
        
        const stmt = this.db.prepare(`
            INSERT INTO audit_logs (uuid, tabela, registro_id, acao, dados_anteriores, dados_novos, usuario_id, ip_address, user_agent, endpoint, metodo_http)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        return stmt.run(
            uuid, tabela, registro_id, acao,
            dados_anteriores ? JSON.stringify(dados_anteriores) : null,
            dados_novos ? JSON.stringify(dados_novos) : null,
            usuario_id, ip_address, user_agent, endpoint, metodo_http
        );
    }
    
    // ==================== ESTATÍSTICAS ====================
    
    getDashboardStats() {
        const stats = {};
        
        // Total de usuários
        stats.totalUsuarios = this.db.prepare(`
            SELECT COUNT(*) as total FROM usuarios WHERE deletado_em IS NULL
        `).get().total;
        
        // Total de pedidos hoje
        stats.pedidosHoje = this.db.prepare(`
            SELECT COUNT(*) as total FROM pedidos WHERE DATE(criado_em) = DATE('now')
        `).get().total;
        
        // Total de vendas (valor)
        stats.totalVendas = this.db.prepare(`
            SELECT COALESCE(SUM(total), 0) as total FROM pedidos WHERE status IN ('pago', 'enviado', 'entregue')
        `).get().total;
        
        // Pedidos por status
        stats.pedidosPorStatus = this.db.prepare(`
            SELECT status, COUNT(*) as total FROM pedidos GROUP BY status
        `).all();
        
        // Produtos com estoque baixo
        stats.estoqueBaixo = this.db.prepare(`
            SELECT sku, nome, estoque FROM produtos WHERE estoque <= 10 AND ativo = 1
        `).all();
        
        return stats;
    }
}

// ============================================================
// TRANSAÇÕES
// ============================================================

/**
 * Executa operações dentro de uma transação
 * @param {Function} operations - Função que recebe o repositório e executa operações
 * @returns {any} - Resultado da operação
 */
function withTransaction(operations) {
    const transaction = db.transaction((repo) => {
        return operations(repo);
    });
    
    return transaction(new Repository(db));
}

// ============================================================
// INICIALIZAR
// ============================================================

initializeDatabase();

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    db,
    Repository,
    withTransaction,
    generateUUID,
    generateOrderNumber,
    updateTimestamp
};
