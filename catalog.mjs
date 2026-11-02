// Single-merchant pilot. Merchant must validate genuine customer demand before launch.
export const CATALOG = Object.freeze([
  Object.freeze({
    sku: 'merchant-operations-pack-v1',
    name: 'Lightning Merchant Operations Pack',
    category: 'Digital resource',
    amount: '0.25', currency: 'USD',
    description: 'Practical checklists and editable templates for handling payment confirmations, customer handoff, and exceptions.',
    includes: ['Merchant onboarding checklist','Order handoff templates','Payment exception response playbook'],
    file: 'merchant-operations-pack-v1.md'
  })
]);
export function findProduct(sku){return CATALOG.find(p=>p.sku===sku)||null}
export function safeCatalog(){return CATALOG.map(({file,...p})=>p)}
