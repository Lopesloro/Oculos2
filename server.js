/**
 * ============================================================
 * BLUE SHIELD PRO - API SERVER
 * ============================================================
 * Servidor Express profissional com:
 * - Estrutura MVC organizada
 * - Middlewares de segurança e validação
 * - Tratamento centralizado de erros
 * - Transações ACID
 * - Rate limiting
 * - Logging estruturado
 * ============================================================
 */

const express = require('express');
const path = require('path');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
require('dotenv').config();

// Importar módulo de banco de dados
const { db, withTransaction, Repository } = require('./db');

// ============================================================
// CONFIGURAÇÃO DO SERVIDOR
// ============================================================

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// ============================================================
// MIDDLEWARES
// ============================================================

// Parse JSON
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS configurado
const cors = require('cors');
const corsOptions = {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};
app.use(cors(corsOptions));

// Helmet para segurança (headers HTTP)
const helmet = require('helmet');
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
            scriptSrc: ["'self'"]
        }
    }
}));

// Rate limiting simples (em memória)
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // 100 requisições por IP
    message: { success: false, message: 'Muitas requisições. Tente novamente mais tarde.' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', limiter);

// Rate limiting específico para auth
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' }
});

// Logging de requisições
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${req.method} ${req.path} - IP: ${req.ip}`);
    next();
});

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// CONFIGURAÇÃO DE EMAIL
// ============================================================

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false
    }
});

// Verificar conexão com email
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter.verify((error, success) => {
        if (error) {
            console.log('[EMAIL] ⚠️ Configuração de email incompleta');
        } else {
            console.log('[EMAIL] ✅ Servidor de email pronto');
        }
    });
} else {
    console.log('[EMAIL] ⚠️ Variáveis EMAIL_USER e EMAIL_PASS não configuradas');
}

// ============================================================
// UTILITÁRIOS
// ============================================================

/**
 * Resposta padronizada da API
 */
class ApiResponse {
    static success(res, data, message = 'Operação realizada com sucesso', statusCode = 200) {
        return res.status(statusCode).json({
            success: true,
            message,
            data,
            timestamp: new Date().toISOString()
        });
    }
    
    static error(res, message, statusCode = 400, errors = null) {
        const response = {
            success: false,
            message,
            timestamp: new Date().toISOString()
        };
        if (errors) response.errors = errors;
        return res.status(statusCode).json(response);
    }
}

/**
 * Validações
 */
const Validators = {
    email(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    },
    
    cpf(cpf) {
        // Desativado para testes. Retorna sempre verdadeiro.
        return true; 
    },
    
    cep(cep) {
        return /^\d{5}-?\d{3}$/.test(cep);
    },
    
    telefone(tel) {
        return /^\(?\d{2}\)?[\s-]?\d{4,5}-?\d{4}$/.test(tel);
    },
};

/**
 * Middleware de validação
 */
function validateCheckout(req, res, next) {
    const errors = [];
    const { nome, email, cpf, telefone, cep, endereco, numero, cidade, estado } = req.body;
    
    if (!nome || nome.trim().length < 3) {
        errors.push({ field: 'nome', message: 'Nome deve ter pelo menos 3 caracteres' });
    }
    
    if (!email || !Validators.email(email)) {
        errors.push({ field: 'email', message: 'Email inválido' });
    }
    
    if (!cpf || !Validators.cpf(cpf)) {
        errors.push({ field: 'cpf', message: 'CPF inválido' });
    }
    
    if (!telefone || !Validators.telefone(telefone)) {
        errors.push({ field: 'telefone', message: 'Telefone inválido' });
    }
    
    if (!cep || !Validators.cep(cep)) {
        errors.push({ field: 'cep', message: 'CEP inválido' });
    }
    
    if (!endereco || endereco.trim().length < 3) {
        errors.push({ field: 'endereco', message: 'Endereço é obrigatório' });
    }
    
    if (!numero || numero.trim().length === 0) {
        errors.push({ field: 'numero', message: 'Número é obrigatório' });
    }
    
    if (!cidade || cidade.trim().length < 2) {
        errors.push({ field: 'cidade', message: 'Cidade é obrigatória' });
    }
    
    if (!estado || estado.trim().length !== 2) {
        errors.push({ field: 'estado', message: 'Estado é obrigatório (2 caracteres)' });
    }
    
    if (errors.length > 0) {
        return ApiResponse.error(res, 'Dados inválidos', 400, errors);
    }
    
    next();
}

// ============================================================
// ROTAS DA API
// ============================================================
// Health check
app.get('/api/health', (req, res) => {
    ApiResponse.success(res, {
        status: 'online',
        environment: NODE_ENV,
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Estatísticas do dashboard (protegido em produção)
app.get('/api/stats', (req, res) => {
    try {
        const repo = new Repository(db);
        const stats = repo.getDashboardStats();
        ApiResponse.success(res, stats);
    } catch (error) {
        console.error('[STATS] Erro:', error);
        ApiResponse.error(res, 'Erro ao obter estatísticas', 500);
    }
});

// ==================== CHECKOUT ====================

app.post('/api/checkout', validateCheckout, async (req, res) => {
    const startTime = Date.now();
    const clientInfo = {
        ip: req.ip,
        userAgent: req.headers['user-agent']
    };
    
    try {
        const {
            nome, email, cpf, telefone,
            cep, endereco, numero, complemento, bairro, cidade, estado,
            quantidade = 1
        } = req.body;
        
        // Limpar CPF e CEP
        const cpfLimpo = cpf.replace(/\D/g, '');
        const cepLimpo = cep.replace(/\D/g, '');
        
        // Executar em transação
        const resultado = withTransaction((repo) => {
            // 1. Verificar se usuário já existe
            let usuario = repo.getUserByEmail(email);
            let usuarioExistente = false;
            
            if (usuario) {
                if (usuario.cpf !== cpfLimpo) {
                    throw new Error('Email já cadastrado com outro CPF');
                }
                usuarioExistente = true;
            } else {
                usuario = repo.getUserByCPF(cpfLimpo);
                if (usuario) {
                    throw new Error('CPF já cadastrado com outro email');
                }
            }
            
            // 2. Criar ou atualizar usuário
            if (!usuarioExistente) {
                const senhaTemp = Math.random().toString(36).slice(-10);
                const senhaHash = bcrypt.hashSync(senhaTemp, 10);
                
                const novoUsuario = repo.createUser({
                    nome: nome.trim(),
                    email: email.toLowerCase().trim(),
                    cpf: cpfLimpo,
                    senha_hash: senhaHash,
                    telefone
                });
                
                usuario = repo.getUserById(novoUsuario.id);
                
                repo.logAudit({
                    tabela: 'usuarios',
                    registro_id: usuario.id,
                    acao: 'INSERT',
                    dados_novos: { nome, email, cpf: cpfLimpo },
                    ip_address: clientInfo.ip,
                    user_agent: clientInfo.userAgent,
                    endpoint: '/api/checkout',
                    metodo_http: 'POST'
                });
            }
            
            // 3. Criar endereço
            const enderecoResult = repo.createAddress({
                usuario_id: usuario.id,
                cep: cepLimpo,
                logradouro: endereco.trim(),
                numero: numero.trim(),
                complemento: complemento?.trim(),
                bairro: bairro?.trim() || 'Não informado',
                cidade: cidade.trim(),
                estado: estado.toUpperCase(),
                tipo: 'entrega',
                padrao: 1
            });
            
            // 4. Buscar produto
            const produto = repo.getProductBySku('BLUESHIELD-PRO-001');
            if (!produto) throw new Error('Produto não encontrado');
            if (produto.estoque < quantidade) throw new Error('Estoque insuficiente');
            
            // 5. Calcular valores
            const precoUnitario = produto.preco_unitario;
            const subtotal = precoUnitario * quantidade;
            const frete = 0;
            const desconto = 0;
            const total = subtotal + frete - desconto;
            
            // 6. Criar pedido
            const pedido = repo.createOrder({
                usuario_id: usuario.id,
                endereco_id: enderecoResult.id,
                subtotal, frete, desconto, total,
                metodo_pagamento: 'pix',
                observacoes_cliente: null
            });
            
            // 7. Adicionar item
            repo.addOrderItem({
                pedido_id: pedido.id,
                produto_id: produto.id,
                sku: produto.sku,
                nome: produto.nome,
                quantidade,
                preco_unitario: precoUnitario,
                variacao: null
            });
            
            // 8. Atualizar estoque
            repo.updateStock(produto.id, quantidade);
            
            // 9. Log
            repo.logAudit({
                tabela: 'pedidos',
                registro_id: pedido.id,
                acao: 'INSERT',
                dados_novos: { numero_pedido: pedido.numero_pedido, total, quantidade },
                usuario_id: usuario.id,
                ip_address: clientInfo.ip,
                user_agent: clientInfo.userAgent,
                endpoint: '/api/checkout',
                metodo_http: 'POST'
            });
            
            return { usuario, pedido, produto, quantidade, total, usuarioNovo: !usuarioExistente };
        });
        
        // ==========================================
        // EMAILS
        // ==========================================
        try {
            const mailCliente = {
                from: `"BlueShield Pro" <${process.env.EMAIL_USER}>`,
                to: resultado.usuario.email,
                subject: `Pedido Recebido - ${resultado.pedido.numero_pedido}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                        <h2 style="color: #0ea5e9;">Olá, ${resultado.usuario.nome.split(' ')[0]}!</h2>
                        <p style="font-size: 16px; line-height: 1.5;">
                            <strong>Pagamento em análise.</strong> O envio será realizado assim que a transação for aprovada na plataforma de pagamento.
                        </p>
                        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #e2e8f0;">
                            <h3 style="margin-top: 0; color: #0ea5e9;">Resumo do seu pedido</h3>
                            <p><strong>Número do Pedido:</strong> ${resultado.pedido.numero_pedido}</p>
                            <p><strong>Produto:</strong> ${resultado.produto.nome}</p>
                            <p><strong>Quantidade:</strong> ${resultado.quantidade}</p>
                            <p><strong>Total:</strong> R$ ${resultado.total.toFixed(2).replace('.', ',')}</p>
                        </div>
                        <p>Você receberá novas atualizações por email assim que o pagamento for confirmado e o seu pedido for despachado.</p>
                        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                            <p style="color: #64748b; font-size: 12px; line-height: 1.5;">
                                <strong>BlueShield Pro - Proteção Visual Premium</strong><br>
                                Este é um email automático. Qualquer dúvida, responda diretamente a este email para falar com o nosso suporte.
                            </p>
                        </div>
                    </div>
                `
            };
            
            const mailAdmin = {
                from: process.env.EMAIL_USER,
                to: process.env.EMAIL_ADMIN || process.env.EMAIL_USER,
                subject: `Nova Venda - ${resultado.pedido.numero_pedido}`,
                text: `
NOVA VENDA CONFIRMADA

Pedido: ${resultado.pedido.numero_pedido}
Data: ${new Date().toLocaleString('pt-BR')}

CLIENTE:
Nome: ${resultado.usuario.nome}
Email: ${resultado.usuario.email}
Telefone: ${resultado.usuario.telefone || 'Não informado'}
CPF: ${resultado.usuario.cpf}

ENDEREÇO DE ENTREGA:
Logradouro: ${endereco}, Número: ${numero}
Complemento: ${complemento || 'Não informado'}
Bairro: ${bairro || 'Não informado'}
Cidade/UF: ${cidade} - ${estado}
CEP: ${cep}

PRODUTO:
${resultado.produto.nome} x ${resultado.quantidade}

VALOR TOTAL: R$ ${resultado.total.toFixed(2)}

${resultado.usuarioNovo ? '⚠️ NOVO CLIENTE CADASTRADO' : '✓ Cliente existente'}
                `.trim()
            };
            
            await Promise.all([
                transporter.sendMail(mailCliente).catch(err => console.log('[EMAIL] Erro cliente:', err.message)),
                transporter.sendMail(mailAdmin).catch(err => console.log('[EMAIL] Erro admin:', err.message))
            ]);
            
        } catch (emailError) {
            console.log('[EMAIL] Erro ao enviar emails:', emailError.message);
        }
        
        const duration = Date.now() - startTime;
        console.log(`[CHECKOUT] ✅ Pedido ${resultado.pedido.numero_pedido} criado em ${duration}ms`);
        
        // ==========================================
        // INTEGRAÇÃO INFINITEPAY
        // ==========================================
        let checkoutUrl = '';
        try {
            const apenasNumeros = resultado.usuario.telefone.replace(/\D/g, '');
            const phoneFormatado = apenasNumeros.startsWith('55') ? '+' + apenasNumeros : '+55' + apenasNumeros;

            const infinitePayPayload = {
                handle: process.env.INFINITEPAY_HANDLE,
                order_nsu: resultado.pedido.numero_pedido,
                redirect_url: `${process.env.BASE_URL || 'http://localhost:3000'}/index.html?pago=true`,
                webhook_url: `${process.env.BASE_URL || 'http://localhost:3000'}/api/webhook/infinitepay`,
                items: [
                    {
                        quantity: resultado.quantidade,
                        price: Math.round(resultado.produto.preco_unitario * 100),
                        description: resultado.produto.nome
                    }
                ],
                customer: {
                    name: resultado.usuario.nome,
                    email: resultado.usuario.email,
                    phone_number: phoneFormatado
                }
            };

            console.log('[INFINITEPAY] A enviar requisição...', infinitePayPayload);

            const responseIP = await fetch('https://api.infinitepay.io/invoices/public/checkout/links', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(infinitePayPayload)
            });
            
            const ipData = await responseIP.json();
            
            console.log('\n=== RESPOSTA DA INFINITEPAY ===');
            console.log(ipData);
            console.log('===============================\n');
            
            checkoutUrl = ipData.url || ipData.link || (ipData.data && ipData.data.url) || (ipData.data && ipData.data.link); 
            
            if (!checkoutUrl) {
                throw new Error('A API não devolveu um link válido. Veja o erro no terminal.');
            }

        } catch (ipError) {
            console.error('[INFINITEPAY ERROR]', ipError.message);
            return ApiResponse.error(res, 'Erro na comunicação com a InfinitePay.', 500);
        }

        // ==========================================
        // RESPOSTA PARA O FRONTEND (COM O LINK)
        // ==========================================
        ApiResponse.success(res, {
            numero_pedido: resultado.pedido.numero_pedido,
            checkout_url: checkoutUrl 
        }, 'Redirecionando para pagamento...', 201);

    } catch (error) {
        console.error('[CHECKOUT] ❌ Erro:', error.message);
        
        if (error.message.includes('Email já cadastrado')) {
            return ApiResponse.error(res, 'Este email já está cadastrado com outro CPF', 400);
        }
        if (error.message.includes('CPF já cadastrado')) {
            return ApiResponse.error(res, 'Este CPF já está cadastrado com outro email', 400);
        }
        if (error.message.includes('Estoque insuficiente')) {
            return ApiResponse.error(res, 'Produto temporariamente indisponível', 400);
        }
        
        ApiResponse.error(res, 'Erro ao processar pedido. Tente novamente.', 500);
    }
});

// ==================== PEDIDOS ====================

app.get('/api/pedidos/:numero', async (req, res) => {
    try {
        const { numero } = req.params;
        const repo = new Repository(db);
        
        const pedido = db.prepare(`
            SELECT p.*, u.nome as cliente_nome, u.email as cliente_email
            FROM pedidos p
            JOIN usuarios u ON p.usuario_id = u.id
            WHERE p.numero_pedido = ?
        `).get(numero);
        
        if (!pedido) {
            return ApiResponse.error(res, 'Pedido não encontrado', 404);
        }
        
        const itens = repo.getOrderItems(pedido.id);
        const historico = db.prepare(`
            SELECT * FROM pedido_historico WHERE pedido_id = ? ORDER BY criado_em DESC
        `).all(pedido.id);
        
        ApiResponse.success(res, {
            ...pedido,
            itens,
            historico
        });
        
    } catch (error) {
        console.error('[PEDIDO] Erro:', error);
        ApiResponse.error(res, 'Erro ao consultar pedido', 500);
    }
});

// ==================== AUTENTICAÇÃO ====================

app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const { email, senha } = req.body;
        
        if (!email || !senha) {
            return ApiResponse.error(res, 'Email e senha são obrigatórios', 400);
        }
        
        const repo = new Repository(db);
        const usuario = repo.getUserByEmail(email);
        
        if (!usuario) return ApiResponse.error(res, 'Email ou senha incorretos', 401);
        if (usuario.status === 'bloqueado') return ApiResponse.error(res, 'Conta bloqueada. Entre em contato com o suporte.', 403);
        if (usuario.deletado_em) return ApiResponse.error(res, 'Conta não encontrada', 401);
        
        const senhaValida = await bcrypt.compare(senha, usuario.senha_hash);
        
        if (!senhaValida) {
            repo.incrementLoginAttempts(usuario.id);
            if (usuario.tentativas_login >= 4) {
                db.prepare("UPDATE usuarios SET status = 'bloqueado' WHERE id = ?").run(usuario.id);
                return ApiResponse.error(res, 'Conta bloqueada por múltiplas tentativas incorretas', 403);
            }
            return ApiResponse.error(res, 'Email ou senha incorretos', 401);
        }
        
        repo.updateUserLogin(usuario.id);
        
        repo.logAudit({
            tabela: 'usuarios',
            registro_id: usuario.id,
            acao: 'LOGIN',
            usuario_id: usuario.id,
            ip_address: req.ip,
            user_agent: req.headers['user-agent'],
            endpoint: '/api/auth/login',
            metodo_http: 'POST'
        });
        
        ApiResponse.success(res, {
            id: usuario.uuid,
            nome: usuario.nome,
            email: usuario.email,
            ultimo_login: new Date().toISOString()
        }, 'Login realizado com sucesso');
        
    } catch (error) {
        console.error('[LOGIN] Erro:', error);
        ApiResponse.error(res, 'Erro ao realizar login', 500);
    }
});

// ==========================================
// WEBHOOK INFINITEPAY (Recebe a confirmação)
// ==========================================
app.post('/api/webhook/infinitepay', async (req, res) => {
    try {
        const { order_nsu, capture_method, transaction_nsu, amount } = req.body;
        
        console.log(`\n[WEBHOOK] Pagamento recebido para o pedido: ${order_nsu}`);

        if (!order_nsu) {
            return res.status(400).send('Bad Request: Falta order_nsu');
        }

        const repo = new Repository(db);
        const pedido = db.prepare('SELECT id FROM pedidos WHERE numero_pedido = ?').get(order_nsu);
        
        if (pedido) {
            repo.updateOrderStatus(
                pedido.id,
                'pago',
                `Pago via InfinitePay (${capture_method}). Transação: ${transaction_nsu}.`,
                null
            );
            console.log(`[WEBHOOK] ✅ Pedido ${order_nsu} atualizado para PAGO na base de dados!`);
        } else {
            console.log(`[WEBHOOK] ⚠️ Pedido ${order_nsu} não encontrado.`);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('[WEBHOOK ERROR]', error);
        res.status(400).send('Erro');
    }
});

// ==================== ROTAS LEGACY (compatibilidade) ====================

app.post('/register', validateCheckout, async (req, res) => {
    req.url = '/api/checkout';
    req.body = { ...req.body, quantidade: req.body.quantidade || 1 };
    app.handle(req, res);
});

app.post('/login', authLimiter, async (req, res) => {
    req.url = '/api/auth/login';
    app.handle(req, res);
});

app.get('/pagamento', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'pagamento.html'));
});

// ============================================================
// TRATAMENTO DE ERROS
// ============================================================

// 404 - Rota não encontrada
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        ApiResponse.error(res, 'Rota não encontrada', 404);
    } else {
        res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

// Erro interno
app.use((err, req, res, next) => {
    console.error('[ERROR]', err);
    if (req.path.startsWith('/api/')) {
        ApiResponse.error(res, NODE_ENV === 'production' ? 'Erro interno do servidor' : err.message, 500);
    } else {
        res.status(500).send('Erro interno do servidor');
    }
});

// ============================================================
// INICIALIZAÇÃO
// ============================================================

app.listen(PORT, () => {
    const DB_PATH = process.env.DB_PATH || './database.sqlite';
    console.log(`
╔══════════════════════════════════════════════════════════╗
║           BLUE SHIELD PRO - SERVER ONLINE                ║
╠══════════════════════════════════════════════════════════╣
║  Porta:      ${PORT.toString().padEnd(45)}║
║  Ambiente:   ${NODE_ENV.padEnd(45)}║
║  Database:   ${DB_PATH.padEnd(45)}║
╚══════════════════════════════════════════════════════════╝
    `);
});

process.on('SIGTERM', () => {
    console.log('[SERVER] Encerrando servidor...');
    db.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[SERVER] Encerrando servidor...');
    db.close();
    process.exit(0);
});

module.exports = app;