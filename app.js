require('dotenv').config();
const express = require('express');
const { Sequelize, DataTypes } = require('sequelize');
const AWS = require('aws-sdk');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// --- CONFIGURACIÓN DE AWS ---
AWS.config.update({
    region: 'us-east-1', 
    accessKeyId: process.env.AWS_ACCESS_KEY_ID, 
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: process.env.AWS_SESSION_TOKEN 
});

const s3 = new AWS.S3();
const sns = new AWS.SNS();
const dynamodb = new AWS.DynamoDB.DocumentClient();

const BUCKET_NAME = 'api-escuela-fotos-22216884';
const SNS_TOPIC_ARN = 'arn:aws:sns:us-east-1:422086831588:NotificacionesAlumnos';

const upload = multer({ storage: multer.memoryStorage() });

// --- CONFIGURACIÓN DE BASE DE DATOS Y ORM ---
const sequelize = new Sequelize('escuela-db', 'admin', 'jjiimm613', {
    host: 'escuela-db.c2pamcjyiow2.us-east-1.rds.amazonaws.com',
    dialect: 'mysql' 
});

const Alumno = sequelize.define('Alumno', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    nombres: { type: DataTypes.STRING, allowNull: false },
    apellidos: { type: DataTypes.STRING, allowNull: false },
    matricula: { type: DataTypes.STRING, allowNull: false },
    promedio: { type: DataTypes.FLOAT, allowNull: false },
    fotoPerfilUrl: { type: DataTypes.STRING, allowNull: true },
    password: { type: DataTypes.STRING, allowNull: false }
}, { timestamps: false });

const Profesor = sequelize.define('Profesor', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    numeroEmpleado: { type: DataTypes.STRING, allowNull: false },
    nombres: { type: DataTypes.STRING, allowNull: false },
    apellidos: { type: DataTypes.STRING, allowNull: false },
    horasClase: { type: DataTypes.INTEGER, allowNull: false }
}, { timestamps: false });

sequelize.sync();


// --- ENDPOINTS DE ALUMNOS (CRUD Base) ---

app.get('/alumnos', async (req, res) => {
    const alumnos = await Alumno.findAll();
    res.status(200).json(alumnos);
});

app.get('/alumnos/:id', async (req, res) => {
    const alumno = await Alumno.findByPk(req.params.id);
    if (!alumno) return res.status(404).json({ error: "Alumno no encontrado" });
    res.status(200).json(alumno);
});

app.post('/alumnos', async (req, res) => {
    try {
        const nuevo = await Alumno.create(req.body);
        res.status(201).json(nuevo);
    } catch (error) {
        res.status(400).json({ error: "Datos inválidos" });
    }
});

app.put('/alumnos/:id', async (req, res) => {
    const alumno = await Alumno.findByPk(req.params.id);
    if (!alumno) return res.status(404).json({ error: "Alumno no encontrado" });
    
    try {
        await alumno.update(req.body);
        res.status(200).json(alumno);
    } catch (error) {
        res.status(400).json({ error: "Datos inválidos" });
    }
});

app.delete('/alumnos/:id', async (req, res) => {
    const alumno = await Alumno.findByPk(req.params.id);
    if (!alumno) return res.status(404).json({ error: "Alumno no encontrado" });
    await alumno.destroy();
    res.status(200).json({ mensaje: "Alumno eliminado" });
});

// --- ENDPOINTS DE PROFESORES (CRUD Base) ---

app.get('/profesores', async (req, res) => {
    try {
        const profesores = await Profesor.findAll();
        res.status(200).json(profesores);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener profesores" });
    }
});

app.get('/profesores/:id', async (req, res) => {
    try {
        const profesor = await Profesor.findByPk(req.params.id);
        if (!profesor) return res.status(404).json({ error: "Profesor no encontrado" });
        
        res.status(200).json(profesor);
    } catch (error) {
        res.status(500).json({ error: "Error al obtener el profesor" });
    }
});

app.post('/profesores', async (req, res) => {
    try {
        const nuevoProfesor = await Profesor.create(req.body);
        res.status(201).json(nuevoProfesor);
    } catch (error) {
        res.status(400).json({ error: "Datos inválidos", detalle: error.errors });
    }
});

app.put('/profesores/:id', async (req, res) => {
    try {
        const profesor = await Profesor.findByPk(req.params.id);
        if (!profesor) return res.status(404).json({ error: "Profesor no encontrado" });
        
        await profesor.update(req.body);
        res.status(200).json(profesor);
    } catch (error) {
        res.status(400).json({ error: "Datos inválidos", detalle: error.errors });
    }
});

app.delete('/profesores/:id', async (req, res) => {
    try {
        const profesor = await Profesor.findByPk(req.params.id);
        if (!profesor) return res.status(404).json({ error: "Profesor no encontrado" });
        
        await profesor.destroy();
        res.status(200).json({ mensaje: "Profesor eliminado correctamente" });
    } catch (error) {
        res.status(500).json({ error: "Error al eliminar el profesor" });
    }
});

// --- ENDPOINTS DE INTEGRACIÓN AWS ---

// Subir Foto a S3
app.post('/alumnos/:id/fotoPerfil', upload.single('foto'), async (req, res) => {
    const alumno = await Alumno.findByPk(req.params.id);
    if (!alumno) return res.status(404).json({ error: "Alumno no encontrado" });
    if (!req.file) return res.status(400).json({ error: "No se envió ninguna imagen" });

    const params = {
        Bucket: BUCKET_NAME,
        Key: `fotos/${req.params.id}_${Date.now()}_${req.file.originalname}`,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        ACL: 'public-read' 
    };

    try {
        const data = await s3.upload(params).promise();
        await alumno.update({ fotoPerfilUrl: data.Location });
        
        res.status(200).json({ mensaje: "Foto subida", fotoPerfilUrl: data.Location });
        
    } catch (error) {
        res.status(500).json({ error: "Error al subir a S3", detalle: error });
    }
});

// Enviar Correo con SNS
app.post('/alumnos/:id/email', async (req, res) => {
    const alumno = await Alumno.findByPk(req.params.id);
    if (!alumno) return res.status(404).json({ error: "Alumno no encontrado" });

    const mensaje = `Información del Alumno:\nNombre: ${alumno.nombres} ${alumno.apellidos}\nPromedio: ${alumno.promedio}`;

    const params = {
        Message: mensaje,
        TopicArn: SNS_TOPIC_ARN
    };

    try {
        await sns.publish(params).promise();
        res.status(200).json({ mensaje: "Correo enviado mediante SNS" });
    } catch (error) {
        res.status(500).json({ error: "Error al enviar SNS", detalle: error });
    }
});

// --- ENDPOINTS DE SESIÓN ---

app.post('/alumnos/:id/session/login', async (req, res) => {
    const alumno = await Alumno.findByPk(req.params.id);
    if (!alumno) return res.status(404).json({ error: "Alumno no encontrado" });
    if (alumno.password !== req.body.password) return res.status(400).json({ error: "Contraseña incorrecta" });

    const sessionString = crypto.randomBytes(64).toString('hex'); // Genera 128 caracteres

    const params = {
        TableName: 'sesiones-alumnos',
        Item: {
            id: crypto.randomUUID(),
            fecha: Date.now(),
            alumnoId: parseInt(req.params.id),
            active: true,
            sessionString: sessionString
        }
    };

    try {
        await dynamodb.put(params).promise();
        res.status(200).json({ sessionString: sessionString });
    } catch (error) {
        res.status(500).json({ error: "Error en DynamoDB", detalle: error });
    }
});

app.post('/alumnos/:id/session/verify', async (req, res) => {
    const { sessionString } = req.body;
    
    const params = {
        TableName: 'sesiones-alumnos',
        FilterExpression: 'sessionString = :ss AND alumnoId = :aid',
        ExpressionAttributeValues: {
            ':ss': sessionString,
            ':aid': parseInt(req.params.id)
        }
    };

    try {
        const data = await dynamodb.scan(params).promise();
        if (data.Items.length > 0 && data.Items[0].active === true) {
            res.status(200).json({ valido: true });
        } else {
            res.status(400).json({ valido: false });
        }
    } catch (error) {
        res.status(500).json({ error: "Error en DynamoDB", detalle: error });
    }
});

app.post('/alumnos/:id/session/logout', async (req, res) => {
    const { sessionString } = req.body;

    const scanParams = {
        TableName: 'sesiones-alumnos',
        FilterExpression: 'sessionString = :ss AND alumnoId = :aid',
        ExpressionAttributeValues: {
            ':ss': sessionString,
            ':aid': parseInt(req.params.id)
        }
    };

    try {
        const data = await dynamodb.scan(scanParams).promise();
        if (data.Items.length > 0) {
            const sessionId = data.Items[0].id;
            
            const updateParams = {
                TableName: 'sesiones-alumnos',
                Key: { id: sessionId },
                UpdateExpression: 'set active = :a',
                ExpressionAttributeValues: { ':a': false }
            };
            
            await dynamodb.update(updateParams).promise();
            res.status(200).json({ mensaje: "Logout exitoso" });
        } else {
            res.status(400).json({ error: "Sesión no encontrada" });
        }
    } catch (error) {
        res.status(500).json({ error: "Error en DynamoDB", detalle: error });
    }
});

// --- 7. MANEJADORES 405 (MÉTODOS NO PERMITIDOS) ---
// Se ejecutan solo si la ruta coincide pero el método HTTP no fue atrapado arriba

const metodoNoPermitido = (req, res) => {
    res.status(405).json({ error: "Método no permitido" });
};

// Rutas de Alumnos
app.all('/alumnos', metodoNoPermitido);
app.all('/alumnos/:id', metodoNoPermitido);

// Rutas de Profesores
app.all('/profesores', metodoNoPermitido);
app.all('/profesores/:id', metodoNoPermitido);

// Rutas de AWS (Segunda Entrega)
app.all('/alumnos/:id/fotoPerfil', metodoNoPermitido);
app.all('/alumnos/:id/email', metodoNoPermitido);
app.all('/alumnos/:id/session/login', metodoNoPermitido);
app.all('/alumnos/:id/session/verify', metodoNoPermitido);
app.all('/alumnos/:id/session/logout', metodoNoPermitido);

// 404
app.use((req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
});

// Servidor
const PORT = 80;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});