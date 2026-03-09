import { supabase } from '../lib/supabase'
import { evaluateWarrantyForSystem } from './warrantyService'

interface ActorInfo { actor_id: string; actor_name?: string }

// ═══════════════════════════════════════════════════════════════
// SUBMIT PROOF
// ═══════════════════════════════════════════════════════════════
export async function submitProof(
  complianceRequirementId: string, proofUrl: string, proofType: string, actor: ActorInfo,
  serviceCompletionId?: string
): Promise<string> {
  const { data: req } = await supabase.from('compliance_requirements').select('customer_id').eq('id', complianceRequirementId).single()
  if (!req) throw new Error('Requirement not found')

  const { data: proof, error } = await supabase.from('compliance_proofs').insert({
    compliance_requirement_id: complianceRequirementId,
    service_completion_id: serviceCompletionId || null,
    customer_id: req.customer_id,
    proof_url: proofUrl, proof_type: proofType,
    submitted_by: actor.actor_id, review_status: 'pending',
  }).select('id').single()

  if (error) throw new Error(`Proof submission failed: ${error.message}`)

  await supabase.from('customer_activity_log').insert({
    customer_id: req.customer_id, event_type: 'proof_submitted',
    title: `Compliance proof submitted`,
    metadata: { proof_id: (proof as any).id, requirement_id: complianceRequirementId, proof_type: proofType },
    actor_id: actor.actor_id, actor_name: actor.actor_name || null,
  }).then(() => {}).catch(() => {})

  return (proof as any).id
}

// ═══════════════════════════════════════════════════════════════
// REVIEW PROOF
// FIX #5: Triggers warranty re-eval on BOTH accepted AND rejected
// ═══════════════════════════════════════════════════════════════
export async function reviewProof(
  proofId: string, reviewStatus: 'accepted' | 'rejected', reviewer: ActorInfo, notes?: string
): Promise<void> {
  const { data: proof } = await supabase.from('compliance_proofs').select('compliance_requirement_id, customer_id').eq('id', proofId).single()
  if (!proof) throw new Error('Proof not found')

  await supabase.from('compliance_proofs').update({
    review_status: reviewStatus, reviewed_by: reviewer.actor_id,
    reviewed_at: new Date().toISOString(), review_notes: notes || null,
  }).eq('id', proofId)

  // Find the installed system for this requirement
  const { data: req } = await supabase.from('compliance_requirements').select('installed_system_id')
    .eq('id', proof.compliance_requirement_id).single()

  // FIX #5: Re-evaluate warranty on BOTH outcomes
  if (req) {
    await evaluateWarrantyForSystem(req.installed_system_id)
  }

  await supabase.from('customer_activity_log').insert({
    customer_id: proof.customer_id, event_type: 'proof_reviewed',
    title: `Proof ${reviewStatus}${notes ? ': ' + notes : ''}`,
    metadata: { proof_id: proofId, status: reviewStatus },
    actor_id: reviewer.actor_id, actor_name: reviewer.actor_name || null,
  }).then(() => {}).catch(() => {})
}
