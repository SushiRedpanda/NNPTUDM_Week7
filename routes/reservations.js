var express = require('express');
var router = express.Router();
let { checkLogin } = require('../utils/authHandler.js')
let cartModel = require('../schemas/cart')
let reservationModel = require('../schemas/reservations')
let inventoryModel = require('../schemas/inventories')
let productModel = require('../schemas/products')
const mongoose = require('mongoose');

// get all cua user -> get reservations/
router.get('/', checkLogin, async function (req, res, next) {
    try {
        let userId = req.userId;
        let reservations = await reservationModel.find({ user: userId });
        res.status(200).send({
            success: true,
            data: reservations
        });
    } catch (error) {
        res.status(400).send({
            success: false,
            message: error.message
        });
    }
});

// get 1 cua user -> get reservations/:id
router.get('/:id', checkLogin, async function (req, res, next) {
    try {
        let userId = req.userId;
        let reservation = await reservationModel.findOne({ _id: req.params.id, user: userId });
        if (!reservation) {
            return res.status(404).send({ success: false, message: 'Reservation not found' });
        }
        res.status(200).send({
            success: true,
            data: reservation
        });
    } catch (error) {
        res.status(400).send({
            success: false,
            message: error.message
        });
    }
});

// reserveACart -> post reserveACart/
router.post('/reserveACart', checkLogin, async function (req, res, next) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        let userId = req.userId;
        let cart = await cartModel.findOne({ user: userId }).session(session);
        if (!cart || cart.items.length === 0) {
            throw new Error("Cart is empty");
        }

        let reservationItems = [];
        let totalAmount = 0;

        for (let item of cart.items) {
            let product = await productModel.findById(item.product).session(session);
            if (!product) throw new Error(`Product ${item.product} not found`);

            let inventory = await inventoryModel.findOne({ product: item.product }).session(session);
            if (!inventory) throw new Error(`Inventory for product ${product.title} not found`);

            if (inventory.stock - inventory.reserved < item.quantity) {
                throw new Error(`Not enough stock for ${product.title}`);
            }

            inventory.reserved += item.quantity;
            await inventory.save({ session });

            let price = product.price;
            let subtotal = price * item.quantity;
            totalAmount += subtotal;

            reservationItems.push({
                product: item.product,
                quantity: item.quantity,
                price: price,
                subtotal: subtotal
            });
        }

        let newReservation = new reservationModel({
            user: userId,
            items: reservationItems,
            totalAmount: totalAmount,
            status: "actived",
            ExpiredAt: new Date(Date.now() + 60 * 60 * 1000) // 1 hour from now
        });

        await newReservation.save({ session });

        // Empty the cart
        cart.items = [];
        await cart.save({ session });

        await session.commitTransaction();
        session.endSession();
        res.status(200).send({
            success: true,
            data: newReservation
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).send({
            success: false,
            message: error.message
        });
    }
});

// reserveItems -> post reserveItems/
router.post('/reserveItems', checkLogin, async function (req, res, next) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        let userId = req.userId;
        let items = req.body.items; // Expects { items: [{ product: "id", quantity: 2 }] }

        if (!items || items.length === 0) {
            throw new Error("Items list is required");
        }

        let reservationItems = [];
        let totalAmount = 0;

        for (let item of items) {
            if (!item.quantity || item.quantity <= 0) {
                throw new Error("Invalid quantity for product " + item.product);
            }

            let product = await productModel.findById(item.product).session(session);
            if (!product) throw new Error(`Product ${item.product} not found`);

            let inventory = await inventoryModel.findOne({ product: item.product }).session(session);
            if (!inventory) throw new Error(`Inventory for product ${product.title} not found`);

            if (inventory.stock - inventory.reserved < item.quantity) {
                throw new Error(`Not enough stock for ${product.title}`);
            }

            inventory.reserved += item.quantity;
            await inventory.save({ session });

            let price = product.price;
            let subtotal = price * item.quantity;
            totalAmount += subtotal;

            reservationItems.push({
                product: item.product,
                quantity: item.quantity,
                price: price,
                subtotal: subtotal
            });
        }

        let newReservation = new reservationModel({
            user: userId,
            items: reservationItems,
            totalAmount: totalAmount,
            status: "actived",
            ExpiredAt: new Date(Date.now() + 60 * 60 * 1000) // 1 hour
        });

        await newReservation.save({ session });
        await session.commitTransaction();
        session.endSession();
        
        res.status(200).send({
            success: true,
            data: newReservation
        });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(400).send({
            success: false,
            message: error.message
        });
    }
});

// cancelReserve -> post cancelReserve/:id
router.post('/cancelReserve/:id', checkLogin, async function (req, res, next) {
    try {
        let userId = req.userId;
        let reservationId = req.params.id;

        let reservation = await reservationModel.findOne({ _id: reservationId, user: userId });
        if (!reservation) {
            return res.status(404).send({ success: false, message: 'Reservation not found' });
        }

        if (reservation.status === 'cancelled') {
            return res.status(400).send({ success: false, message: 'Reservation is already cancelled' });
        }
        
        if (reservation.status !== 'actived') {
            return res.status(400).send({ success: false, message: 'Only an active reservation can be cancelled' });
        }

        // Restore inventory for each item sequentially
        for (let item of reservation.items) {
            let inventory = await inventoryModel.findOne({ product: item.product });
            if (inventory) {
                inventory.reserved -= item.quantity;
                if (inventory.reserved < 0) inventory.reserved = 0;
                await inventory.save();
            }
        }

        reservation.status = 'cancelled';
        await reservation.save();

        res.status(200).send({
            success: true,
            message: 'Reservation cancelled successfully',
            data: reservation
        });
    } catch (error) {
        res.status(400).send({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;
