// ============================================================
// ZENITH CRM OS — FEDEX CREATE LABEL
// api/shipping/create-label.js
// Authenticates with FedEx, creates shipment, returns tracking + label
// ============================================================

import { createClient } from '@supabase/supabase-js';

const FEDEX_BASE = 'https://apis-sandbox.fedex.com';
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { shipment_id } = req.body;
  if (!shipment_id) return res.status(400).json({ error: 'shipment_id required' });

  const fedexApiKey        = process.env.FEDEX_API_KEY;
  const fedexSecretKey     = process.env.FEDEX_SECRET_KEY;
  const fedexAccountNumber = process.env.FEDEX_ACCOUNT_NUMBER;

  if (!fedexApiKey || !fedexSecretKey || !fedexAccountNumber) {
    return res.status(500).json({ error: 'FedEx credentials not configured' });
  }
  if (!supabaseUrl || !supabaseServiceKey) {
    return res.status(500).json({ error: 'Missing Supabase env vars' });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // 1. Fetch shipment details
    const { data: shipment, error: shipErr } = await supabase
      .from('shipments')
      .select('*, products(name, sku)')
      .eq('id', shipment_id)
      .single();

    if (shipErr || !shipment) {
      return res.status(404).json({ error: 'Shipment not found' });
    }

    if (!shipment.ship_to_address || !shipment.ship_to_city || !shipment.ship_to_state || !shipment.ship_to_zip) {
      return res.status(400).json({ error: 'Shipment is missing shipping address' });
    }

    // 2. Get FedEx OAuth token
    const tokenRes = await fetch(`${FEDEX_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: fedexApiKey,
        client_secret: fedexSecretKey,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      console.error('[fedex] OAuth failed:', JSON.stringify(tokenData));
      return res.status(500).json({
        error: 'FedEx authentication failed',
        detail: tokenData.errors || tokenData,
      });
    }

    const token = tokenData.access_token;

    // 3. Build shipment payload
    // labelResponseOptions at TOP LEVEL only — not inside requestedShipment
    const shipPayload = {
      labelResponseOptions: 'LABEL',
      requestedShipment: {
        shipper: {
          contact: {
            personName: 'Zenith Pure Solutions',
            phoneNumber: '3176904172',
            companyName: 'Zenith Pure Solutions',
          },
          address: {
            streetLines: ['6951 E 30th St Suite B'],
            city: 'Indianapolis',
            stateOrProvinceCode: 'IN',
            postalCode: '46219',
            countryCode: 'US',
            residential: false,
          },
        },
        recipients: [
          {
            contact: {
              personName: shipment.ship_to_name || 'Customer',
              phoneNumber: '3170000000',
            },
            address: {
              streetLines: [shipment.ship_to_address],
              city: shipment.ship_to_city,
              stateOrProvinceCode: shipment.ship_to_state,
              postalCode: String(shipment.ship_to_zip).slice(0, 5),
              countryCode: 'US',
              residential: true,
            },
          },
        ],
        shippingChargesPayment: {
          paymentType: 'SENDER',
          payor: {
            responsibleParty: {
              accountNumber: { value: fedexAccountNumber },
              address: {
                countryCode: 'US',
              },
            },
          },
        },
        labelSpecification: {
          imageType: 'PDF',
          labelStockType: 'PAPER_4X6',
        },
        totalWeight: {
          value: 2,
          units: 'LB',
        },
        requestedPackageLineItems: [
          {
            sequenceNumber: 1,
            weight: {
              value: 2,
              units: 'LB',
            },
            dimensions: {
              length: 10,
              width: 8,
              height: 4,
              units: 'IN',
            },
            customerReferences: [
              {
                customerReferenceType: 'CUSTOMER_REFERENCE',
                value: shipment.id.slice(0, 30),
              },
            ],
          },
        ],
        serviceType: 'FEDEX_GROUND',
        packagingType: 'YOUR_PACKAGING',
        pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
        totalPackageCount: 1,
      },
    };

    console.log('[fedex] Sending payload to', `${FEDEX_BASE}/ship/v1/shipments`);

    const shipRes = await fetch(`${FEDEX_BASE}/ship/v1/shipments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-locale': 'en_US',
        'X-Customer-Transaction-Id': shipment_id.slice(0, 30),
      },
      body: JSON.stringify(shipPayload),
    });

    const shipData = await shipRes.json();

    if (!shipRes.ok || !shipData.output?.transactionShipments?.length) {
      console.error('[fedex] Shipment creation failed:', JSON.stringify(shipData));
      console.error('[fedex] Full payload sent:', JSON.stringify(shipPayload));
      const fedexErrors = shipData.errors || shipData.output?.alerts || [];
      const errorCodes  = fedexErrors.map((e) => `${e.code}: ${e.message} (parameterList: ${JSON.stringify(e.parameterList)})`).join(' | ');
      return res.status(500).json({
        error: 'FedEx shipment creation failed',
        detail: errorCodes || JSON.stringify(fedexErrors),
        raw: shipData,
      });
    }

    const txShipment     = shipData.output.transactionShipments[0];
    const trackingNumber = txShipment.masterTrackingNumber?.trackingNumber
      || txShipment.pieceResponses?.[0]?.trackingNumber
      || null;

    // LABEL mode returns base64 encoded label data, not a URL
    const labelBase64 = txShipment.pieceResponses?.[0]?.packageDocuments?.[0]?.encodedLabel || null;
    const labelUrl    = txShipment.pieceResponses?.[0]?.packageDocuments?.[0]?.url
      || (labelBase64 ? `data:application/pdf;base64,${labelBase64}` : null);

    // 4. Update shipment in DB
    const { error: updateErr } = await supabase
      .from('shipments')
      .update({
        tracking_number: trackingNumber,
        label_url: labelUrl,
        status: 'label_created',
        updated_at: new Date().toISOString(),
      })
      .eq('id', shipment_id);

    if (updateErr) {
      console.error('[fedex] DB update error:', updateErr);
    }

    console.log(`[fedex] Label created for shipment ${shipment_id}: tracking=${trackingNumber}`);

    return res.status(200).json({
      success: true,
      tracking_number: trackingNumber,
      label_url: labelUrl,
    });

  } catch (err) {
    console.error('[fedex] create-label error:', err);
    return res.status(500).json({ error: 'Failed to create FedEx label', detail: err.message });
  }
}
