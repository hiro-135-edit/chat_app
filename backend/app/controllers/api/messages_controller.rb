# frozen_string_literal: true

# app/controllers/api/messages_controller.rb

module Api
  class MessagesController < BffController
    before_action :set_room, only: %i[index create show update destroy]
    before_action :set_message, only: %i[show update destroy]
    before_action :authorize_message_owner!, only: %i[update destroy]

    def index
      messages = @room.messages.includes(:user).order(created_at: :asc)

      render json: message_json(messages)
    end

    def create
      user = User.find_by(id: params[:user_id])
      return render json: { error: 'unauthorized' }, status: :unauthorized unless user

      body = params[:body].to_s
      return render json: { error: 'missing_body' }, status: :bad_request if body.strip.empty?

      message = @room.messages.build(body: body, user: user)

      if message.save
        render json: message_json(message), status: :created
      else
        render json: { errors: message.errors.full_messages }, status: :unprocessable_entity
      end
    end

    def show
      render json: message_json(@message)
    end

    def update
      body = params[:body].to_s.strip
      return render json: { error: 'missing_body' }, status: :bad_request if body.empty?

      return render json: { error: 'edit_window_expired' }, status: :forbidden unless @message.editable_by?(@requester)

      # params[:body] は「送られてきた本文」
      # .to_s は数値を文字列化するためだが、このニュアンスは nil ガード（nil の場合は空文字列に変換）

      if @message.update(body: body, edited_at: Time.current)
        render json: message_json(@message)
      else
        render json: { errors: @message.errors.full_messages }, status: :unprocessable_entity
      end
    end

    def destroy
      if @message.destroy
        head :no_content
      else
        render json: { errors: @message.errors.full_messages }, status: :unprocessable_entity
      end
    end

    private

    def set_room
      @room = Room.find_by(id: params[:room_id])
      return if @room

      render json: { error: 'room_not_found' }, status: :not_found
    end

    def set_message
      @message = @room.messages.find_by(id: params[:id])
      return if @message

      render json: { error: 'message_not_found' }, status: :not_found
    end

    def authorize_message_owner!
      @requester = User.find_by(id: request.headers['X-User-Id'])
      return render json: { error: 'unauthorized' }, status: :unauthorized unless @requester
      return if @message.user_id == @requester.id

      render json: { error: 'forbidden' }, status: :forbidden
    end

    def message_json(message_or_collection)
      message_or_collection.as_json(
        only: %i[id body room_id user_id created_at edited_at],
        include: { user: { only: %i[id name] } }
      )
    end
  end
end

# as_json が「Rubyオブジェクト → Hash/Array」に変換する
# render json:が「RubyのArray/Hash → JSON文字列」にしてHTTPレスポンスにする
# @変数はインスタンス変数、メソッドをまたぐ時、同じオブジェクト内で共有したい時に使う
