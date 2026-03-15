// ============================================================
// ZENITH CRM OS — FEDEX TRACKING
// api/shipping/track.js
// Looks up tracking status from FedEx
// ============================================================

const FEDEX_BASE = 'https://apis.fedex.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { tracking_number } = req.body;
  if (!tracking_number) return res.status(400).json({ error: 'tracking_number required' });

  const fedexApiKey = process.env.FEDEX_API_KEY;
  const fedexSecretKey = process.env.FEDEX_SECRET_KEY;

  if (!fedexApiKey || !fedexSecretKey) {
    return res.status(500).json({ error: 'FedEx credentials not configured' });
  }

  try {
    // 1. Get OAuth token
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
      return res.status(500).json({ error: 'FedEx authentication failed' });
    }

    // 2. Track package
    const trackRes = await fetch(`${FEDEX_BASE}/track/v1/trackingnumbers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenData.access_token}`,
        'X-locale': 'en_US',
      },
      body: JSON.stringify({
        includeDetailedScans: false,
        trackingInfo: [
          {
            trackingNumberInfo: {
              trackingNumber: tracking_number,
            },
          },
        ],
      }),
    });

    const trackData = await trackRes.json();

    if (!trackRes.ok) {
      console.error('[fedex] Tracking failed:', JSON.stringify(trackData));
      return res.status(500).json({ error: 'FedEx tracking failed', detail: trackData.errors || trackData });
    }

    const result = trackData.output?.completeTrackResults?.[0]?.trackResults?.[0];

    if (!result) {
      return res.status(404).json({ error: 'No tracking results found' });
    }

    // Map FedEx status to our shipment statuses
    const fedexStatus = result.latestStatusDetail?.statusByLocale || '';
    const fedexCode = result.latestStatusDetail?.code || '';

    let mappedStatus = 'shipped';
    if (['DL', 'DE'].includes(fedexCode)) mappedStatus = 'delivered';
    else if (['IT', 'IX', 'AF', 'AR', 'DP', 'OD'].includes(fedexCode)) mappedStatus = 'in_transit';
    else if (['PU', 'PX'].includes(fedexCode)) mappedStatus = 'shipped';

    const estimatedDelivery = result.dateAndTimes?.find(
      (d) => d.type === 'ESTIMATED_DELIVERY' || d.type === 'ACTUAL_DELIVERY'
    )?.dateTime || null;

    return res.status(200).json({
      success: true,
      tracking_number,
      status: mappedStatus,
      fedex_status: fedexStatus,
      fedex_code: fedexCode,
      estimated_delivery: estimatedDelivery,
      description: result.latestStatusDetail?.description || '',
      location: result.latestStatusDetail?.scanLocation?.city
        ? `${result.latestStatusDetail.scanLocation.city}, ${result.latestStatusDetail.scanLocation.stateOrProvinceCode || ''}`
        : null,
    });

  } catch (err) {
    console.error('[fedex] track error:', err);
    return res.status(500).json({ error: 'Failed to track package', detail: err.message });
  }
}
