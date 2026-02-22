/**
 * ============================================================
 * BLUE SHIELD PRO - API SERVER
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

// Helmet para segurança
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

// Rate limiting simples
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { success: false, message: 'Muitas requisições. Tente novamente mais tarde.' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', limiter);

// Rate limiting auth
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

const Validators = {
    email(email) {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    },
    cpf(cpf) {
        return true; // Desativado para testes
    },
    cep(cep) {
        return /^\d{5}-?\d{3}$/.test(cep);
    },
    telefone(tel) {
        return /^\(?\d{2}\)?[\s-]?\d{4,5}-?\d{4}$/.test(tel);
    },
};

function validateCheckout(req, res, next) {
    const errors = [];
    const { nome, email, cpf, telefone, cep, endereco, numero, cidade, estado } = req.body;
    
    if (!nome || nome.trim().length < 3) errors.push({ field: 'nome', message: 'Nome inválido' });
    if (!email || !Validators.email(email)) errors.push({ field: 'email', message: 'Email inválido' });
    if (!cpf || !Validators.cpf(cpf)) errors.push({ field: 'cpf', message: 'CPF inválido' });
    if (!telefone || !Validators.telefone(telefone)) errors.push({ field: 'telefone', message: 'Telefone inválido' });
    if (!cep || !Validators.cep(cep)) errors.push({ field: 'cep', message: 'CEP inválido' });
    if (!endereco || endereco.trim().length < 3) errors.push({ field: 'endereco', message: 'Endereço obrigatório' });
    if (!numero || numero.trim().length === 0) errors.push({ field: 'numero', message: 'Número obrigatório' });
    if (!cidade || cidade.trim().length < 2) errors.push({ field: 'cidade', message: 'Cidade obrigatória' });
    if (!estado || estado.trim().length !== 2) errors.push({ field: 'estado', message: 'Estado obrigatório (2 caracteres)' });
    
    if (errors.length > 0) {
        return ApiResponse.error(res, 'Dados inválidos', 400, errors);
    }
    next();
}

// ============================================================
// ROTAS DA API
// ============================================================

app.get('/api/health', (req, res) => {
    ApiResponse.success(res, { status: 'online', environment: NODE_ENV, version: '1.0.0' });
});

app.get('/api/stats', (req, res) => {
    try {
        const repo = new Repository(db);
        ApiResponse.success(res, repo.getDashboardStats());
    } catch (error) {
        ApiResponse.error(res, 'Erro ao obter estatísticas', 500);
    }
});

// ==================== CHECKOUT ====================

app.post('/api/checkout', validateCheckout, async (req, res) => {
    const startTime = Date.now();
    const clientInfo = { ip: req.ip, userAgent: req.headers['user-agent'] };
    
    try {
        const { nome, email, cpf, telefone, cep, endereco, numero, complemento, bairro, cidade, estado, quantidade = 1 } = req.body;
        const cpfLimpo = cpf.replace(/\D/g, '');
        const cepLimpo = cep.replace(/\D/g, '');
        
        const resultado = withTransaction((repo) => {
            let usuario = repo.getUserByEmail(email);
            let usuarioExistente = false;
            
            if (usuario) {
                if (usuario.cpf !== cpfLimpo) throw new Error('Email já cadastrado com outro CPF');
                usuarioExistente = true;
            } else {
                usuario = repo.getUserByCPF(cpfLimpo);
                if (usuario) throw new Error('CPF já cadastrado com outro email');
            }
            
            if (!usuarioExistente) {
                const senhaHash = bcrypt.hashSync(Math.random().toString(36).slice(-10), 10);
                const novoUsuario = repo.createUser({
                    nome: nome.trim(), email: email.toLowerCase().trim(), cpf: cpfLimpo, senha_hash: senhaHash, telefone
                });
                usuario = repo.getUserById(novoUsuario.id);
            }
            
            const enderecoResult = repo.createAddress({
                usuario_id: usuario.id, cep: cepLimpo, logradouro: endereco.trim(), numero: numero.trim(),
                complemento: complemento?.trim(), bairro: bairro?.trim() || 'Não informado', cidade: cidade.trim(),
                estado: estado.toUpperCase(), tipo: 'entrega', padrao: 1
            });
            
            const produto = repo.getProductBySku('BLUESHIELD-PRO-001');
            if (!produto) throw new Error('Produto não encontrado');
            if (produto.estoque < quantidade) throw new Error('Estoque insuficiente');
            
            const precoUnitario = produto.preco_unitario;
            const subtotal = precoUnitario * quantidade;
            const total = subtotal;
            
            const pedido = repo.createOrder({
                usuario_id: usuario.id, endereco_id: enderecoResult.id, subtotal, frete: 0, desconto: 0, total,
                metodo_pagamento: 'pix', observacoes_cliente: null
            });
            
            repo.addOrderItem({
                pedido_id: pedido.id, produto_id: produto.id, sku: produto.sku, nome: produto.nome,
                quantidade, preco_unitario: precoUnitario, variacao: null
            });
            
            repo.updateStock(produto.id, quantidade);
            
            return { usuario, pedido, produto, quantidade, total, usuarioNovo: !usuarioExistente };
        });
        
        // Emails
        try {
            const mailCliente = {
                from: `"BlueShield Pro" <${process.env.EMAIL_USER}>`,
                to: resultado.usuario.email,
                subject: `Pedido Recebido - ${resultado.pedido.numero_pedido}`,
                html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;"><h2 style="color: #0ea5e9;">Olá, ${resultado.usuario.nome.split(' ')[0]}!</h2><p><strong>Pagamento em análise.</strong> O envio será realizado assim que a transação for aprovada.</p></div>`
            };
            
            const mailAdmin = {
                from: process.env.EMAIL_USER,
                to: process.env.EMAIL_ADMIN || process.env.EMAIL_USER,
                subject: `Nova Venda - ${resultado.pedido.numero_pedido}`,
                text: `Nova venda: ${resultado.pedido.numero_pedido}\nCliente: ${resultado.usuario.nome}\nTotal: R$ ${resultado.total.toFixed(2)}`
            };
            
            await Promise.all([
                transporter.sendMail(mailCliente).catch(() => {}),
                transporter.sendMail(mailAdmin).catch(() => {})
            ]);
        } catch (e) {}
        
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
                items: [ // <-- CORRIGIDO AQUI PARA "items"
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

            console.log('[INFINITEPAY] Enviando payload:', infinitePayPayload);

            const responseIP = await fetch('https://api.infinitepay.io/invoices/public/checkout/links', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(infinitePayPayload)
            });
            
            const ipData = await responseIP.json();
            console.log('\n=== RESPOSTA INFINITEPAY ===\n', ipData, '\n============================\n');
            
            checkoutUrl = ipData.url || ipData.link || (ipData.data && ipData.data.url) || (ipData.data && ipData.data.link); 
            
            if (!checkoutUrl) throw new Error('A API não devolveu um link válido.');

        } catch (ipError) {
            console.error('[INFINITEPAY ERROR]', ipError.message);
            return ApiResponse.error(res, 'Erro na comunicação com a InfinitePay.', 500);
        }

        ApiResponse.success(res, {
            numero_pedido: resultado.pedido.numero_pedido,
            checkout_url: checkoutUrl 
        }, 'Redirecionando para pagamento...', 201);

    } catch (error) {
        console.error('[CHECKOUT ERROR]', error.message);
        if (error.message.includes('Email já cadastrado')) return ApiResponse.error(res, 'Este email já está cadastrado com outro CPF', 400);
        if (error.message.includes('CPF já cadastrado')) return ApiResponse.error(res, 'Este CPF já está cadastrado com outro email', 400);
        ApiResponse.error(res, 'Erro ao processar pedido. Tente novamente.', 500);
    }
});

// ==========================================
// WEBHOOK INFINITEPAY
// ==========================================
app.post('/api/webhook/infinitepay', async (req, res) => {
    try {
        const { order_nsu, capture_method, transaction_nsu } = req.body;
        console.log(`\n[WEBHOOK] Pagamento recebido para o pedido: ${order_nsu}`);

        if (!order_nsu) return res.status(400).send('Falta order_nsu');

        const repo = new Repository(db);
        const pedido = db.prepare('SELECT id FROM pedidos WHERE numero_pedido = ?').get(order_nsu);
        
        if (pedido) {
            repo.updateOrderStatus(pedido.id, 'pago', `Pago via InfinitePay (${capture_method}). Transação: ${transaction_nsu}.`, null);
            console.log(`[WEBHOOK] ✅ Pedido ${order_nsu} atualizado para PAGO!`);
        }
        res.status(200).send('OK');
    } catch (error) {
        res.status(400).send('Erro');
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

process.on('SIGTERM', () => { db.close(); process.exit(0); });
process.on('SIGINT', () => { db.close(); process.exit(0); });

module.exports = app;