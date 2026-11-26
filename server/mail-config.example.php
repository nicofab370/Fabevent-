<?php
/**
 * Réglages d'envoi des emails de FabEvent.
 * Copie ce fichier en « mail-config.php » à côté de mail.php sur l'hébergement, puis remplis-le.
 * Ne mets JAMAIS mail-config.php dans Git : il contient le mot de passe de la boîte mail.
 */
return [
    // adresse d'expédition : « noreply » de ton domaine (par défaut : noreply@<domaine du site>).
    // Le serveur SMTP doit accepter d'envoyer avec cette adresse (en général : la boîte noreply elle-même).
    'from' => 'noreply@fabri.live',
    'fromName' => 'FABRI.live',
    // « Répondre à » : les réponses des destinataires arrivent ici. FabEvent envoie celle de
    // Paramètres → Ma société → « Réponses aux mails » ; celle-ci sert de secours (ex. mot de passe oublié).
    'replyTo' => 'nicolas@fabri.live',
    // serveur SMTP de la boîte (recommandé). Sans ce bloc, la fonction mail() de l'hébergement est utilisée.
    'smtp' => [
        'host' => 'smtp.exemple.be',
        'port' => 587,          // 587 + 'tls' (STARTTLS), ou 465 + 'ssl'
        'secure' => 'tls',
        'user' => 'noreply@fabri.live',
        'pass' => 'mot-de-passe-de-la-boite',
    ],
];
