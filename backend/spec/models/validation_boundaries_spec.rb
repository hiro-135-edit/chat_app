# frozen_string_literal: true

require 'rails_helper'

RSpec.describe 'Domain validation boundaries' do
  include ActiveSupport::Testing::TimeHelpers

  let(:user) { create_confirmed_user }
  let(:room) { Room.create!(title: 'room', user:) }

  describe User do
    [
      ['Abc1234', false], ['Abc12345', true], ['Abc123456', true],
      ['abcdefgh', false], ['12345678', false], ['Abc1234!', false],
      ['Abc1234 ', false], ['日本語Ab123', false], ['', false]
    ].each do |password, valid|
      it "checks password composition and the 8-character boundary: #{password.inspect}" do
        candidate = User.new(name: 'Alice', email: 'alice@example.com', password:)
        expect(candidate.valid?).to be(valid)
      end
    end

    it 'allows profile changes without replacing the existing password' do
      original = user.encrypted_password
      expect(user.update(name: 'Changed')).to be(true)
      expect(user.reload.encrypted_password).to eq(original)
      expect(user.jwt_subject).to eq(user.id.to_s)
    end
  end

  describe Message do
    [nil, '', ' ', "\t\n", 'x' * 501].each do |body|
      it "rejects absent, whitespace-only or oversized messages: #{body.to_s.size} characters" do
        message = room.messages.build(user:, body:)
        expect(message).not_to be_valid
        expect(message.errors[:body]).not_to be_empty
      end
    end
    [1, 499, 500].each do |size|
      it "accepts #{size} characters" do
        expect(room.messages.build(user:, body: 'x' * size)).to be_valid
      end
    end
    it 'requires both the room and author associations' do
      expect(Message.new(body: 'hello')).not_to be_valid
    end
    it 'checks each ownership/time condition independently' do
      freeze_time do
        message = room.messages.create!(user:, body: 'hello', created_at: 1.hour.ago)
        expect(message.editable_by?(nil)).to be(false)
        expect(message.editable_by?(create_confirmed_user)).to be(false)
        expect(message.editable_by?(user)).to be(true)
        travel 1.second
        expect(message.editable_by?(user)).to be(false)
      end
    end
  end
end
