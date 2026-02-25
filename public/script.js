/**
 * ============================================================
 * BLUE SHIELD PRO - FRONTEND SCRIPTS
 * ============================================================
 * Scripts otimizados para integração com API profissional
 */

// ============================================================
// UTILITÁRIOS
// ============================================================

/**
 * Exibe toast notification
 */
function showToast(msg, type = '') {
    const toast = document.getElementById('toast');
    if (!toast) return;
    
    toast.textContent = msg;
    toast.className = 'toast show ' + type;
    
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { 
        toast.className = 'toast'; 
    }, 3500);
}

/**
 * Máscara de CPF
 */
function maskCPF(v) {
    v = v.replace(/\D/g, '').substring(0, 11);
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d)/, '$1.$2');
    v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    return v;
}

/**
 * Máscara de telefone
 */
function maskPhone(v) {
    v = v.replace(/\D/g, '').substring(0, 11);
    if (v.length <= 10) {
        v = v.replace(/(\d{2})(\d{4})(\d{0,4})/, '($1) $2-$3');
    } else {
        v = v.replace(/(\d{2})(\d{5})(\d{0,4})/, '($1) $2-$3');
    }
    return v;
}

/**
 * Máscara de CEP
 */
function maskCEP(v) {
    v = v.replace(/\D/g, '').substring(0, 8);
    v = v.replace(/(\d{5})(\d{0,3})/, '$1-$2');
    return v;
}

/**
 * Aplica máscara em um input
 */
function applyMask(id, fn) {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener('input', e => { 
            e.target.value = fn(e.target.value); 
        });
    }
}

/**
 * Formata valor monetário
 */
function fmt(val) {
    return new Intl.NumberFormat('pt-BR', { 
        style: 'currency', 
        currency: 'BRL' 
    }).format(val);
}

// ============================================================
// NAVEGAÇÃO
// ============================================================

// ============================================================
// NAVEGAÇÃO E BOTÕES (Corrigido)
// ============================================================

// Esperar que a página carregue completamente
document.addEventListener('DOMContentLoaded', () => {
    
    // Navbar scroll effect
    const navbar = document.getElementById('navbar');
    if (navbar) {
        window.addEventListener('scroll', () => {
            navbar.classList.toggle('scrolled', window.scrollY > 20);
        });
    }

    // Mobile menu
    const mobileToggle = document.getElementById('mobile-toggle');
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileToggle && mobileMenu) {
        mobileToggle.addEventListener('click', () => {
            mobileMenu.classList.toggle('open');
        });
        
        mobileMenu.querySelectorAll('.mobile-link').forEach(link => {
            link.addEventListener('click', () => mobileMenu.classList.remove('open'));
        });
    }

    // Botões comprar - redirecionam para pagamento
    // Seleciona botões com a classe e também qualquer botão que chame a atenção
    const buyButtons = document.querySelectorAll('.btn-comprar-trigger, a[href="pagamento.html"]');
    
    buyButtons.forEach(btn => {
        btn.addEventListener('click', e => {
            // Evita o comportamento padrão só se não for um link direto válido
            if (btn.tagName !== 'A') {
                e.preventDefault();
            }
            window.location.href = '/pagamento.html';
        });
    });
});
// ============================================================
// CHECKOUT PAGE
// ============================================================

const UNIT_PRICE =269.00;
let qty = 1;

const qtyEl = document.getElementById('qty');
const subTotalLabel = document.getElementById('sub-total-label');
const totalLabel = document.getElementById('total-label');
const btnPlus = document.getElementById('plus');
const btnMinus = document.getElementById('minus');

function updatePrices() {
    const sub = qty * UNIT_PRICE;
    if (qtyEl) qtyEl.textContent = qty;
    if (subTotalLabel) subTotalLabel.textContent = fmt(sub);
    if (totalLabel) totalLabel.textContent = fmt(sub);
}

if (btnPlus) {
    btnPlus.addEventListener('click', () => { 
        qty++; 
        updatePrices(); 
    });
}

if (btnMinus) {
    btnMinus.addEventListener('click', () => { 
        if (qty > 1) { 
            qty--; 
            updatePrices(); 
        } 
    });
}

// Aplicar máscaras nos campos
applyMask('co-cpf', maskCPF);
applyMask('co-tel', maskPhone);
applyMask('co-cep', maskCEP);

// Buscar endereço pelo CEP
const cepInput = document.getElementById('co-cep');
if (cepInput) {
    cepInput.addEventListener('blur', async (e) => {
        const cep = e.target.value.replace(/\D/g, '');
        if (cep.length === 8) {
            try {
                const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
                const data = await response.json();
                
                if (!data.erro) {
                    document.getElementById('co-endereco').value = data.logradouro || '';
                    document.getElementById('co-cidade').value = data.localidade || '';
                    document.getElementById('co-estado').value = data.uf || '';
                    
                    // Focar no número
                    document.getElementById('co-numero')?.focus();
                }
            } catch (error) {
                console.log('Erro ao buscar CEP:', error);
            }
        }
    });
}

// Formulário de compra
const purchaseForm = document.getElementById('purchase-form');
if (purchaseForm) {
    purchaseForm.addEventListener('submit', async e => {
        e.preventDefault();
        
        const btn = document.getElementById('btn-checkout');
        const originalHTML = btn.innerHTML;
        
        // Validar campos
        const campos = {
            nome: document.getElementById('co-nome')?.value?.trim(),
            email: document.getElementById('co-email')?.value?.trim(),
            cpf: document.getElementById('co-cpf')?.value,
            telefone: document.getElementById('co-tel')?.value,
            cep: document.getElementById('co-cep')?.value,
            endereco: document.getElementById('co-endereco')?.value?.trim(),
            numero: document.getElementById('co-numero')?.value?.trim(),
            complemento: document.getElementById('co-complemento')?.value?.trim(),
            bairro: document.getElementById('co-bairro')?.value?.trim(),
            cidade: document.getElementById('co-cidade')?.value?.trim(),
            estado: document.getElementById('co-estado')?.value?.trim()
        };
        
        // Validações básicas
        if (!campos.nome || campos.nome.length < 3) {
            showToast('Por favor, informe seu nome completo', 'error');
            return;
        }
        
        if (!campos.email || !campos.email.includes('@')) {
            showToast('Por favor, informe um email válido', 'error');
            return;
        }
        
        if (!campos.cpf || campos.cpf.replace(/\D/g, '').length !== 11) {
            showToast('Por favor, informe um CPF válido', 'error');
            return;
        }
        
        if (!campos.telefone || campos.telefone.replace(/\D/g, '').length < 10) {
            showToast('Por favor, informe um telefone válido', 'error');
            return;
        }
        
        if (!campos.cep || campos.cep.replace(/\D/g, '').length !== 8) {
            showToast('Por favor, informe um CEP válido', 'error');
            return;
        }
        
        if (!campos.endereco) {
            showToast('Por favor, informe o endereço', 'error');
            return;
        }
        
        if (!campos.numero) {
            showToast('Por favor, informe o número', 'error');
            return;
        }
        
        if (!campos.cidade) {
            showToast('Por favor, informe a cidade', 'error');
            return;
        }
        
        if (!campos.estado || campos.estado.length !== 2) {
            showToast('Por favor, informe o estado (UF)', 'error');
            return;
        }
        
        // Mostrar loading
        btn.disabled = true;
        btn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 0.8s linear infinite">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            <span>Processando...</span>
        `;
        
        const payload = {
            nome: campos.nome,
            email: campos.email,
            cpf: campos.cpf,
            telefone: campos.telefone,
            cep: campos.cep,
            endereco: campos.endereco,
            numero: campos.numero,
            complemento: campos.complemento,
            bairro: campos.bairro || 'Não informado',
            cidade: campos.cidade,
            estado: campos.estado,
            quantidade: qty
        };
        
        try {
            const res = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            
            const data = await res.json();
            
            if (data.success) {
                showToast(`A redirecionar para o ambiente seguro de pagamento...`, 'success');
                
                // Limpa o formulário
                purchaseForm.reset();
                qty = 1;
                updatePrices();
                
                // Redireciona o cliente para o link gerado pela InfinitePay
                if (data.data && data.data.checkout_url) {
                    setTimeout(() => { 
                        window.location.href = data.data.checkout_url; 
                    }, 1500);
                } else {
                    showToast('Erro: Link de pagamento não encontrado.', 'error');
                }
            } else {
                showToast(data.message || 'Erro ao processar pedido.', 'error');
            }
                
            // Se houver erros de validação detalhados
            if (data.errors && data.errors.length > 0) {
                console.error('Erros de validação:', data.errors);
            }
            
            btn.disabled = false;
            btn.innerHTML = originalHTML;

        } catch (error) {
            console.error('Erro na requisição:', error);
            showToast('Erro de conexão com o servidor. Tente novamente.', 'error');
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    });
}

// Spinner keyframe
const style = document.createElement('style');
style.textContent = `
    @keyframes spin { 
        from { transform: rotate(0deg); } 
        to { transform: rotate(360deg); } 
    }
`;
document.head.appendChild(style);

// Inicializar preços
updatePrices();

// ============================================================
// FUNÇÕES GLOBAIS
// ============================================================

function checkout() {
    window.location.href = 'pagamento.html'; 
}

// Exportar funções para uso global
window.showToast = showToast;
window.checkout = checkout;

// Ativa todos os botões de comprar da página inicial
document.querySelectorAll('.btn-comprar-trigger').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.preventDefault(); // Impede a tela de piscar/sumir
        window.location.href = '/pagamento'; // Redireciona para a rota limpa do servidor
    });
});