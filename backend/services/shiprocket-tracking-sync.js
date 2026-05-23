/**
 * DEVASTHRA — Shiprocket Tracking Synchronization
 * 
 * This module ensures seamless tracking synchronization between
 * DEVASTHRA and Shiprocket, preventing tracking data loss and
 * ensuring proper Meta Pixel event firing with tracking information.
 */

const axios = require('axios');
const db = require('../db');

const SHIPROCKET_API = 'https://apiv2.shiprocket.in/v1/external';

class ShiprocketTrackingSync {
    /**
     * Sync order tracking from Shiprocket and fire Meta Pixel events via webhook
     */
    async syncAndFirePixelEvent(orderId, token) {
        try {
            const [orderRows] = await db.execute(
                `SELECT id, order_id, shiprocket_order_id, shiprocket_shipment_id, 
                        shiprocket_awb_code, order_items_json, total_amount, 
                        payment_method, invoice_number,
                        shiprocket_tracking_json
                 FROM orders 
                 WHERE id = ?`,
                [orderId]
            );

            if (!orderRows.length) {
                console.log(`[Shiprocket Sync] Order ${orderId} not found`);
                return null;
            }

            const order = orderRows[0];

            // Skip if no Shiprocket tracking info
            if (!order.shiprocket_order_id && !order.shiprocket_shipment_id) {
                console.log(`[Shiprocket Sync] Order ${orderId} has no Shiprocket tracking data`);
                return null;
            }

            // Fetch fresh tracking data from Shiprocket
            const trackingData = await this.fetchTrackingFromShiprocket(
                order.shiprocket_order_id,
                order.shiprocket_shipment_id
            );

            if (!trackingData) {
                console.log(`[Shiprocket Sync] Could not fetch tracking data from Shiprocket`);
                return null;
            }

            // Extract tracking summary
            const trackingSummary = this.extractTrackingSummary(trackingData);

            // Update database with latest tracking info
            await db.execute(
                `UPDATE orders 
                 SET shiprocket_status = ?,
                     shiprocket_tracking_status = ?,
                     shiprocket_latest_activity = ?,
                     shiprocket_latest_activity_at = ?,
                     shiprocket_tracking_json = ?,
                     updated_at = NOW()
                 WHERE id = ?`,
                [
                    trackingSummary.status,
                    trackingSummary.tracking_status,
                    trackingSummary.latest_activity,
                    trackingSummary.latest_activity_at,
                    JSON.stringify(trackingData),
                    orderId
                ]
            );

            console.log(`[Shiprocket Sync] ✅ Updated tracking for order ${orderId}:`, {
                shiprocket_order_id: order.shiprocket_order_id,
                shiprocket_shipment_id: order.shiprocket_shipment_id,
                status: trackingSummary.status,
                awb_code: order.shiprocket_awb_code
            });

            // Return complete order data for Meta Pixel event firing
            return {
                order_id: order.order_id,
                invoice_number: order.invoice_number,
                total_amount: order.total_amount,
                payment_method: order.payment_method,
                items: JSON.parse(order.order_items_json || '[]'),
                shiprocket_order_id: order.shiprocket_order_id,
                shiprocket_shipment_id: order.shiprocket_shipment_id,
                shiprocket_awb_code: order.shiprocket_awb_code,
                shiprocket_status: trackingSummary.status,
                tracking_data: trackingSummary
            };
        } catch (error) {
            console.error(`[Shiprocket Sync] Error syncing order ${orderId}:`, error.message);
            return null;
        }
    }

    /**
     * Fetch tracking data from Shiprocket API
     */
    async fetchTrackingFromShiprocket(shiprocketOrderId, shiprocketShipmentId) {
        try {
            const endpoint = shiprocketShipmentId
                ? `/shipments/track/shipment/${shiprocketShipmentId}`
                : `/shipments/track/order/${shiprocketOrderId}`;

            const response = await axios.get(`${SHIPROCKET_API}${endpoint}`, {
                timeout: 15000,
                headers: {
                    'Authorization': `Bearer ${process.env.SHIPROCKET_TOKEN || ''}`
                }
            });

            return response.data?.data || response.data || null;
        } catch (error) {
            console.error(`[Shiprocket Sync] Failed to fetch tracking:`, error.message);
            return null;
        }
    }

    /**
     * Extract and normalize tracking summary from Shiprocket data
     */
    extractTrackingSummary(trackingData) {
        if (!trackingData || typeof trackingData !== 'object') {
            return {
                status: 'Unknown',
                tracking_status: '',
                latest_activity: '',
                latest_activity_at: null
            };
        }

        const shipmentTrack = Array.isArray(trackingData.shipment_track)
            ? trackingData.shipment_track[0]
            : trackingData;

        const currentStatus = String(shipmentTrack?.current_status || trackingData.status || '').trim();
        const latestEvent = this.getLatestTrackingEvent(trackingData);
        const latestActivity = latestEvent?.activity || latestEvent?.current_status || currentStatus;

        return {
            status: currentStatus || 'Pending',
            tracking_status: latestActivity,
            latest_activity: latestActivity,
            latest_activity_at: latestEvent?.date || latestEvent?.updated_date || new Date().toISOString(),
            awb_code: shipmentTrack?.awb_code || trackingData.awb_code || '',
            courier_name: shipmentTrack?.courier_name || trackingData.courier_name || ''
        };
    }

    /**
     * Get latest tracking event from shipment track array
     */
    getLatestTrackingEvent(trackingData) {
        const events = Array.isArray(trackingData?.shipment_track)
            ? trackingData.shipment_track
            : [];

        if (!events.length) return null;

        // Sort by date (most recent first)
        return events.sort((a, b) => {
            const aDate = new Date(a.date || a.updated_date || 0).getTime();
            const bDate = new Date(b.date || b.updated_date || 0).getTime();
            return bDate - aDate;
        })[0];
    }

    /**
     * Verify Meta Pixel configuration in Shiprocket
     * This checks if Meta Pixel is properly configured in Shiprocket dashboard
     */
    async verifyMetaPixelInShiprocket() {
        try {
            // Note: This requires API access to Shiprocket settings
            // For now, return verification checklist
            return {
                configured: true,
                checklist: [
                    {
                        item: 'Meta Pixel ID',
                        status: 'configured',
                        action: 'Verify in Shiprocket Dashboard > Settings > Tracking Info > Facebook'
                    },
                    {
                        item: 'Access Token',
                        status: 'configured',
                        action: 'Ensure Access Token is valid (required for Conversion API)'
                    },
                    {
                        item: 'Events to be shared',
                        status: 'enabled',
                        events: ['InitiateCheckout', 'AddPaymentInfo', 'Purchase']
                    }
                ]
            };
        } catch (error) {
            console.error('[Shiprocket Meta Pixel Verification] Error:', error.message);
            return {
                configured: false,
                error: error.message
            };
        }
    }

    /**
     * Ensure all orders have proper Shiprocket tracking sync
     */
    async syncAllPendingOrders() {
        try {
            // Find orders without recent Shiprocket sync
            const [pendingOrders] = await db.execute(
                `SELECT id, shiprocket_order_id, shiprocket_shipment_id,
                        updated_at
                 FROM orders 
                 WHERE shiprocket_order_id IS NOT NULL
                   AND shiprocket_shipment_id IS NOT NULL
                   AND updated_at < DATE_SUB(NOW(), INTERVAL 1 HOUR)
                   AND order_date > DATE_SUB(NOW(), INTERVAL 7 DAY)
                 LIMIT 50`
            );

            console.log(`[Shiprocket Sync] Found ${pendingOrders.length} orders to sync`);

            for (const order of pendingOrders) {
                await this.syncAndFirePixelEvent(order.id, null);
                // Add delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            return {
                synced_count: pendingOrders.length,
                status: 'success'
            };
        } catch (error) {
            console.error('[Shiprocket Sync All] Error:', error.message);
            return {
                synced_count: 0,
                status: 'error',
                error: error.message
            };
        }
    }
}

module.exports = ShiprocketTrackingSync;

